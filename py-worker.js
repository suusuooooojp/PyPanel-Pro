// py-worker.js
importScripts("https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js");

let pyodide = null;
let sharedBuffer = null;
let sharedStatus = null;

async function loadEngine() {
    try {
        pyodide = await loadPyodide({
            stdout: (text) => self.postMessage({ type: 'stdout', text }),
            stderr: (text) => self.postMessage({ type: 'stdout', text: "⚠ " + text })
        });
        
        // input() Override Setup
        await pyodide.runPythonAsync(`
            import js, sys, builtins
            from pyodide.ffi import to_js

            def _custom_input(prompt=""):
                # 1. Print prompt (if any)
                if prompt:
                    print(prompt, end="")

                # 2. Check if shared buffer is available
                if not js.sharedStatus:
                    return ""

                # 3. Request input from Main Thread
                js.postMessage(to_js({"type": "input_request", "prompt": str(prompt)}))

                # 4. Wait for Main Thread (Atomics.wait)
                # index 0 of sharedStatus: 0 = wait, 1 = ready
                js.Atomics.store(js.sharedStatus, 0, 0)
                js.Atomics.wait(js.sharedStatus, 0, 0)

                # 5. Read from buffer
                # Buffer offset 4 starts the data
                data_view = js.Uint8Array.new(js.sharedBuffer, 4)
                
                # Decode bytes to string until null byte
                # (Simple manual decoding for this snippet)
                chars = []
                for i in range(len(data_view)):
                    b = data_view[i]
                    if b == 0:
                        break
                    chars.append(b)
                
                # Reset for next time
                js.Atomics.store(js.sharedStatus, 0, 0)

                # Convert bytes to string (utf-8)
                return bytes(chars).decode('utf-8')

            builtins.input = _custom_input
        `);

        self.postMessage({ type: 'ready' });
    } catch (e) {
        self.postMessage({ type: 'error', error: e.toString() });
    }
}
loadEngine();

self.onmessage = async (e) => {
    const d = e.data;
    
    if (d.cmd === 'init') {
        // メインスレッドから共有バッファを受け取る
        if (d.buffer) {
            sharedBuffer = d.buffer;
            sharedStatus = new Int32Array(sharedBuffer, 0, 1);
            // Pyodide内からアクセスできるようにグローバルにセット
            self.sharedBuffer = sharedBuffer;
            self.sharedStatus = sharedStatus;
        }
    }
    else if (d.cmd === 'run' && pyodide) {
        try {
            if (d.files) {
                // 仮想ファイルシステムの構築
                for (const [filename, content] of Object.entries(d.files)) {
                    const parts = filename.split('/');
                    if(parts.length > 1) {
                        let path = "";
                        for(let i=0; i<parts.length-1; i++) {
                            path += (path ? "/" : "") + parts[i];
                            try { pyodide.FS.mkdir(path); } catch(e){}
                        }
                    }
                    pyodide.FS.writeFile(filename, content);
                }
            }
            await pyodide.runPythonAsync(d.code);
            self.postMessage({ type: 'results', results: 'Done' });
        } catch (error) {
            self.postMessage({ type: 'error', error: error.toString() });
        }
    }
};

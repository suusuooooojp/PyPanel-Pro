importScripts("https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js");

let pyodide = null;
let micropip = null;

async function loadEngine() {
    try {
        pyodide = await loadPyodide({
            stdout: (text) => self.postMessage({ type: 'stdout', text }),
            stderr: (text) => self.postMessage({ type: 'stdout', text: "⚠ " + text })
        });
        
        await pyodide.loadPackage("micropip");
        micropip = pyodide.pyimport("micropip");

        // Matplotlib backend setup
        await pyodide.runPythonAsync(`
            import sys
            class Capture:
                def write(self, s): pass
                def flush(self): pass
            sys.modules['js'] = Capture() # mock
        `);

        self.postMessage({ type: 'ready' });
    } catch (e) {
        self.postMessage({ type: 'error', error: e.toString() });
    }
}

loadEngine();

self.onmessage = async (e) => {
    const { cmd, code, files, packages } = e.data;

    if (cmd === 'run' && pyodide) {
        try {
            // 1. Install Packages
            if (packages && packages.length > 0) {
                await micropip.install(packages);
            }
            if (packages && packages.includes('matplotlib')) {
                 await pyodide.runPythonAsync(`
                    import matplotlib
                    matplotlib.use("Agg")
                    import matplotlib.pyplot as plt
                `);
            }

            // 2. Virtual File System Setup
            // 送られてきた全てのファイルをPyodideの仮想メモリ空間に書き込む
            if (files) {
                for (const [filename, content] of Object.entries(files)) {
                    // ディレクトリ階層がある場合は作成が必要だが、今回はフラットな構造を想定
                    pyodide.FS.writeFile(filename, content);
                }
            }

            // 3. Run Code
            let results = await pyodide.runPythonAsync(code);
            
            // 4. Check Matplotlib Plot
            if (packages && packages.includes('matplotlib')) {
                let imgData = await pyodide.runPythonAsync(`
                    import io, base64
                    try:
                        buf = io.BytesIO()
                        plt.savefig(buf, format='png')
                        buf.seek(0)
                        img_str = base64.b64encode(buf.read()).decode('utf-8')
                        plt.clf()
                        img_str
                    except:
                        "None"
                `);
                if (imgData && imgData !== "None" && imgData.length > 100) {
                    self.postMessage({ type: 'image', imageData: imgData });
                }
            }

            self.postMessage({ type: 'results', results: String(results) });

        } catch (error) {
            let lineNo = null;
            const match = error.toString().match(/line (\d+)/);
            if (match) lineNo = parseInt(match[1]);
            self.postMessage({ type: 'error', error: error.toString(), line: lineNo });
        }
    }
};

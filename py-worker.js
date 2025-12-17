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
            if (packages && packages.length > 0) await micropip.install(packages);
            if (files) {
                for (const [filename, content] of Object.entries(files)) {
                    // ディレクトリ作成 (簡易)
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
            let results = await pyodide.runPythonAsync(code);
            self.postMessage({ type: 'results', results: String(results) });
        } catch (error) {
            self.postMessage({ type: 'error', error: error.toString() });
        }
    }
};

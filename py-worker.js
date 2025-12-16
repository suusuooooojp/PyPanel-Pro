importScripts("https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js");

let pyodide = null;

async function loadEngine() {
    try {
        pyodide = await loadPyodide({
            stdout: (text) => self.postMessage({ type: 'stdout', text }),
            stderr: (text) => self.postMessage({ type: 'stdout', text: "ERR: " + text })
        });
        self.postMessage({ type: 'ready' });
    } catch (e) {
        self.postMessage({ type: 'error', error: e.toString() });
    }
}

loadEngine();

self.onmessage = async (e) => {
    const { cmd, code } = e.data;

    if (cmd === 'run' && pyodide) {
        try {
            await pyodide.loadPackagesFromImports(code);
            let results = await pyodide.runPythonAsync(code);
            self.postMessage({ type: 'results', results: String(results) });
        } catch (error) {
            self.postMessage({ type: 'error', error: error.toString() });
        }
    }
};

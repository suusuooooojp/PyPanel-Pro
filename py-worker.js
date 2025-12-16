importScripts("https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js");

let pyodide = null;

async function loadEngine() {
    try {
        pyodide = await loadPyodide({
            stdout: (text) => self.postMessage({ type: 'stdout', text, isUserCode: self.isUserCode }),
            stderr: (text) => self.postMessage({ type: 'stdout', text: "ERR: " + text, isUserCode: self.isUserCode })
        });
        self.postMessage({ type: 'ready' });
    } catch (e) {
        self.postMessage({ type: 'error', error: e.toString() });
    }
}

loadEngine();

self.onmessage = async (e) => {
    const { cmd, code, isUserCode } = e.data;
    self.isUserCode = isUserCode;

    if (cmd === 'run' && pyodide) {
        try {
            await pyodide.loadPackagesFromImports(code);
            let results = await pyodide.runPythonAsync(code);
            self.postMessage({ type: 'results', results: String(results), isUserCode });
        } catch (error) {
            self.postMessage({ type: 'error', error: error.toString(), isUserCode });
        }
    }
};

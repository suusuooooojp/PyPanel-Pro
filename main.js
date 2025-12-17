// --- Service Worker ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
}

// --- Monaco Editor Setup ---
require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }});

// Worker Cross-Origin Fix for CDN
window.MonacoEnvironment = {
    getWorkerUrl: function (workerId, label) {
        return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
            self.MonacoEnvironment = {
                baseUrl: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/'
            };
            importScripts('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/base/worker/workerMain.js');`
        )}`;
    }
};

let editor; // Global editor instance

// --- UI References ---
const sidebar = document.getElementById('sidebar');
const fileList = document.getElementById('file-list');
const tabsContainer = document.getElementById('tabs');
const outputDiv = document.getElementById('output');
const previewFrame = document.getElementById('preview-frame');
const statusSpan = document.getElementById('status');
const runBtn = document.getElementById('runBtn');
const stopBtn = document.getElementById('stopBtn');
const terminalPane = document.getElementById('terminal-pane');
const resizer = document.getElementById('resizer');
const popupOverlay = document.getElementById('popup-overlay');
const popupFrame = document.getElementById('popup-content-frame');

// --- Default Files ---
const DEFAULT_FILES = {
    'main.py': {
        content: `# Python Ultra Environment (VS Code Engine)
import sys
import utils

print(f"🐍 Python {sys.version.split()[0]} Running.")
print(f"Utils: {utils.greet('Developer')}")

# Minimap is shown on the right side -->
# You can click it to jump!

# for i in range(100):
#     print(f"Line {i} for testing minimap scroll...")
`,
        mode: 'python'
    },
    'utils.py': {
        content: `def greet(name):
    return f"Hello, {name}!"
`,
        mode: 'python'
    },
    'index.html': {
        content: `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: sans-serif; padding: 20px; background: #f9f9f9; }
  .box { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
  h1 { color: #007acc; }
</style>
</head>
<body>
  <div class="box">
    <h1>Web Preview</h1>
    <p>This is rendered in an iframe.</p>
    <button onclick="alert('Working!')">Test Button</button>
  </div>
</body>
</html>`,
        mode: 'html'
    }
};

let files = JSON.parse(localStorage.getItem('pypanel_files')) || DEFAULT_FILES;
let currentFileName = localStorage.getItem('pypanel_current') || 'main.py';

// --- Initialize Monaco ---
require(['vs/editor/editor.main'], function() {
    editor = monaco.editor.create(document.getElementById('editor-container'), {
        value: files[currentFileName].content,
        language: files[currentFileName].mode === 'js' ? 'javascript' : files[currentFileName].mode,
        theme: 'vs-dark',
        fontSize: 14,
        automaticLayout: true,
        minimap: {
            enabled: true, // ★ミニマップ有効化★
            renderCharacters: false,
            scale: 0.75
        },
        padding: { top: 10 },
        scrollBeyondLastLine: false,
        fontFamily: "'JetBrains Mono', 'Consolas', monospace"
    });

    // 初期設定完了後
    switchFile(currentFileName);
    renderExplorer();
    updateZenkakuDecorations();
    
    // イベントリスナー
    editor.onDidChangeModelContent(() => {
        updateZenkakuDecorations();
        // 自動保存 (debounceなしの簡易実装)
        files[currentFileName].content = editor.getValue();
        localStorage.setItem('pypanel_files', JSON.stringify(files));
    });

    // キーボードショートカット
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, runCode);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveCurrentFile);
});

// --- Worker Setup ---
let worker = null;
let isWorkerReady = false;

function initWorker() {
    if (worker) worker.terminate();
    worker = new Worker('py-worker.js');
    isWorkerReady = false;
    updateStatus("Engine Loading...", "#888");

    worker.onmessage = (e) => {
        const { type, text, results, error, line, imageData } = e.data;
        
        if (type === 'ready') {
            isWorkerReady = true;
            updateStatus("Ready (Python)", "#4ec9b0");
        } else if (type === 'stdout') {
            log(text);
        } else if (type === 'image') {
            const img = document.createElement('img');
            img.src = "data:image/png;base64," + imageData;
            img.className = 'log-img';
            outputDiv.appendChild(img);
            scrollToBottom();
        } else if (type === 'results') {
            if(results && results !== 'None') log("<= " + results, 'log-info');
            setRunning(false);
        } else if (type === 'error') {
            log("❌ " + error, 'log-err');
            if(line) highlightError(line);
            setRunning(false);
        }
    };
}
initWorker();

// --- File System Logic ---
function saveCurrentFile() {
    if(editor && files[currentFileName]) {
        files[currentFileName].content = editor.getValue();
        localStorage.setItem('pypanel_files', JSON.stringify(files));
        localStorage.setItem('pypanel_current', currentFileName);
    }
}

function switchFile(fileName) {
    saveCurrentFile();
    currentFileName = fileName;
    
    const file = files[fileName];
    if(editor) {
        const model = editor.getModel();
        monaco.editor.setModelLanguage(model, file.mode === 'js' ? 'javascript' : file.mode);
        editor.setValue(file.content);
        
        // 全角スペース検知などを再適用
        updateZenkakuDecorations();
        clearErrorDecorations();
    }
    
    // UI同期
    const langSelect = document.getElementById('langSelect');
    if (file.mode === 'python') langSelect.value = 'python';
    else if (file.mode === 'html') langSelect.value = 'web';
    else langSelect.value = 'python';

    renderExplorer();
}

function addNewFile() {
    const name = prompt("Filename:", "new.py");
    if (!name) return;
    if (files[name]) { alert("Exists!"); return; }

    const ext = name.split('.').pop();
    let mode = 'python';
    if(ext === 'html') mode = 'html';
    if(ext === 'js' || ext === 'javascript') mode = 'javascript';

    files[name] = { content: "", mode: mode };
    switchFile(name);
}

function deleteFile(name, e) {
    e.stopPropagation();
    if (!confirm(`Delete ${name}?`)) return;
    delete files[name];
    if (currentFileName === name) {
        currentFileName = Object.keys(files)[0] || "";
        if(currentFileName) switchFile(currentFileName);
        else editor.setValue("");
    }
    renderExplorer();
    saveCurrentFile();
}

function renderExplorer() {
    fileList.innerHTML = "";
    tabsContainer.innerHTML = "";

    Object.keys(files).forEach(name => {
        const item = document.createElement('div');
        item.className = `file-item ${name === currentFileName ? 'active' : ''}`;
        item.innerHTML = `<span>${getFileIcon(name)} ${name}</span><span class="del-btn" onclick="deleteFile('${name}', event)">×</span>`;
        item.onclick = () => switchFile(name);
        fileList.appendChild(item);

        if (name === currentFileName) {
            const tab = document.createElement('div');
            tab.className = "tab active";
            tab.innerText = name;
            tabsContainer.appendChild(tab);
        }
    });
}

function getFileIcon(name) {
    if (name.endsWith('.py')) return '🐍';
    if (name.endsWith('.html')) return '🌐';
    if (name.endsWith('.js')) return '📜';
    return '📄';
}

// --- Decorations (Zenkaku Space & Errors) ---
let zenkakuDecorations = [];
let errorDecorations = [];

function updateZenkakuDecorations() {
    if(!editor) return;
    const model = editor.getModel();
    const text = model.getValue();
    const matches = model.findMatches('　', false, false, false, null, true);
    
    const newDecorations = matches.map(match => ({
        range: match.range,
        options: {
            isWholeLine: false,
            className: 'zenkaku-decoration',
            inlineClassName: 'zenkaku-bg' // CSSでスタイル定義が必要だが今回は簡易的にボーダー
        }
    }));
    
    // Monacoの方法で適用
    // CSSハック: MonacoはCSSクラスを指定するので、styleタグに以下を追加する必要がある
    // 今回は簡易的に実装するため、HTMLのstyleに追加済みとする（.zenkaku-bgなど）
    // と言いたいが、styleタグへの動的追加を行う
    
    zenkakuDecorations = model.deltaDecorations(zenkakuDecorations, newDecorations);
}
// Monaco用のCSS追加
const style = document.createElement('style');
style.innerHTML = `
    .zenkaku-bg { background: rgba(255, 165, 0, 0.4); border-bottom: 2px solid orange; }
    .errorLine { background: rgba(255, 0, 0, 0.2); }
`;
document.head.appendChild(style);

function highlightError(line) {
    if(!editor) return;
    const model = editor.getModel();
    errorDecorations = model.deltaDecorations(errorDecorations, [
        {
            range: new monaco.Range(line, 1, line, 1),
            options: {
                isWholeLine: true,
                className: 'errorLine',
                glyphMarginClassName: 'errorGlyph'
            }
        }
    ]);
    editor.revealLineInCenter(line);
}
function clearErrorDecorations() {
    if(!editor) return;
    errorDecorations = editor.getModel().deltaDecorations(errorDecorations, []);
}


// --- Popup Logic ---
function openPopup() {
    saveCurrentFile();
    const mode = files[currentFileName].mode;
    if (mode === 'python') {
        alert("Pythonはポップアップ表示できません。Webファイルを選択してください。");
        return;
    }
    popupOverlay.style.display = 'flex';
    popupFrame.srcdoc = editor.getValue();
}
function closePopup() {
    popupOverlay.style.display = 'none';
    popupFrame.srcdoc = "";
}


// --- Execution Logic ---
function runCode() {
    saveCurrentFile();
    clearOutput();
    clearErrorDecorations();
    
    const file = files[currentFileName];
    const mode = document.getElementById('langSelect').value;

    if (mode === 'web' || currentFileName.endsWith('.html')) {
        outputDiv.style.display = 'none';
        previewFrame.style.display = 'block';
        previewFrame.srcdoc = editor.getValue();
        log("Web Preview Updated.", 'log-info');
    } else {
        outputDiv.style.display = 'block';
        previewFrame.style.display = 'none';
        
        if (mode === 'python') {
            if (!isWorkerReady) { log("⏳ Engine loading...", 'log-err'); return; }
            setRunning(true);
            
            const fileData = {};
            for (let f in files) fileData[f] = files[f].content;
            
            const code = editor.getValue();
            const packages = [];
            if(code.includes('pandas')) packages.push('pandas');
            if(code.includes('numpy')) packages.push('numpy');
            if(code.includes('matplotlib')) packages.push('matplotlib');

            worker.postMessage({ cmd: 'run', code: code, files: fileData, packages: packages });
        } else if (mode === 'javascript') {
            try {
                const originalLog = console.log;
                console.log = (...args) => log(args.join(' '));
                new Function(editor.getValue())();
                console.log = originalLog;
            } catch(e) {
                log("JS Error: " + e.message, 'log-err');
            }
        }
    }
}

function stopCode() {
    if (worker) {
        worker.terminate();
        log("⛔ Stopped.", 'log-err');
        initWorker();
    }
    setRunning(false);
}

// --- Utils ---
function log(msg, cls) {
    const d = document.createElement('div');
    d.textContent = msg;
    if(cls) d.className = cls;
    outputDiv.appendChild(d);
    outputDiv.scrollTop = outputDiv.scrollHeight;
}
function clearOutput() { outputDiv.innerHTML = ""; if(previewFrame.contentWindow) previewFrame.srcdoc = ""; }
function setRunning(state) {
    runBtn.style.display = state ? 'none' : 'inline-flex';
    stopBtn.style.display = state ? 'inline-flex' : 'none';
    statusSpan.textContent = state ? "Running..." : "Ready";
}
function updateStatus(msg, color) {
    statusSpan.textContent = msg;
    statusSpan.style.color = color;
}
function changeLanguage() {
    const val = document.getElementById('langSelect').value;
    if(val === 'web' && !files['index.html']) {
        files['index.html'] = { content: DEFAULT_FILES['index.html'].content, mode: 'html' };
        renderExplorer();
        switchFile('index.html');
    } else if (val === 'web') {
        switchFile('index.html');
    }
}

// --- Resizer & Sidebar ---
let isResizing = false;
resizer.addEventListener('mousedown', () => { isResizing = true; document.body.style.cursor = 'row-resize'; });
document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const h = window.innerHeight - e.clientY;
    if (h > 50 && h < window.innerHeight - 100) terminalPane.style.height = h + 'px';
    if(editor) editor.layout();
});
document.addEventListener('mouseup', () => { isResizing = false; document.body.style.cursor = 'default'; if(editor) editor.layout(); });
function toggleSidebar() { sidebar.classList.toggle('open'); setTimeout(() => { if(editor) editor.layout(); }, 200); }
window.onresize = () => { if(editor) editor.layout(); };

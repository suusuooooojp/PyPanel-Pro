// --- Service Worker ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
}

// --- Ace Editor Setup ---
ace.require("ace/ext/language_tools");
const editor = ace.edit("editor");
editor.setTheme("ace/theme/vibrant_ink"); // よりモダンなテーマ
editor.setOptions({
    enableBasicAutocompletion: true,
    enableLiveAutocompletion: true,
    enableSnippets: true,
    showPrintMargin: false,
    fontSize: "14px",
    fontFamily: "'JetBrains Mono', monospace",
    tabSize: 4,
    useSoftTabs: true,
    wrap: true,
});

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

// --- State Management (Virtual File System) ---
// デフォルトファイル群
const DEFAULT_FILES = {
    'main.py': {
        content: `# Python Ultra Environment
import sys
import utils # see utils.py

print(f"🐍 Python {sys.version.split()[0]}")
print(f"Calc: {utils.add(10, 20)}")

# Try creating a file
with open("data.txt", "w") as f:
    f.write("Hello from File System!")

with open("data.txt", "r") as f:
    print(f"Read: {f.read()}")

# Import libraries automatically
# import numpy as np
# print(np.random.rand(3))
`,
        mode: 'python'
    },
    'utils.py': {
        content: `# Helper module
def add(a, b):
    return a + b
`,
        mode: 'python'
    },
    'index.html': {
        content: `<!-- Web Mode Preview -->
<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: sans-serif; padding: 20px; background: #f0f0f0; }
  h1 { color: #e91e63; }
</style>
</head>
<body>
  <h1>Hello Web</h1>
  <button onclick="alert('Clicked!')">Click Me</button>
</body>
</html>`,
        mode: 'html'
    }
};

// LocalStorageから読み込むか、初期値を使う
let files = JSON.parse(localStorage.getItem('pypanel_files')) || DEFAULT_FILES;
let currentFileName = localStorage.getItem('pypanel_current') || 'main.py';

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

// --- Editor Logic ---

function saveCurrentFile() {
    if(files[currentFileName]) {
        files[currentFileName].content = editor.getValue();
        localStorage.setItem('pypanel_files', JSON.stringify(files));
        localStorage.setItem('pypanel_current', currentFileName);
    }
}

function switchFile(fileName) {
    saveCurrentFile(); // 前のファイルを保存
    currentFileName = fileName;
    
    // エディタにセット
    const file = files[fileName];
    editor.session.setMode("ace/mode/" + (file.mode === 'js' ? 'javascript' : file.mode));
    editor.setValue(file.content, -1);
    
    // 言語選択ボックスの同期
    const langSelect = document.getElementById('langSelect');
    if (file.mode === 'python') langSelect.value = 'python';
    else if (file.mode === 'html') langSelect.value = 'web';
    else langSelect.value = 'python'; // default

    renderExplorer();
    clearErrorMarkers();
}

function addNewFile() {
    const name = prompt("File Name (e.g. script.py):", "new_file.py");
    if (!name) return;
    if (files[name]) { alert("Exists!"); return; }

    const ext = name.split('.').pop();
    let mode = 'python';
    if(ext === 'html') mode = 'html';
    if(ext === 'js') mode = 'javascript';
    if(ext === 'json') mode = 'json';

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
        else editor.setValue(""); // No files
    }
    renderExplorer();
    saveCurrentFile();
}

function renderExplorer() {
    fileList.innerHTML = "";
    tabsContainer.innerHTML = "";

    Object.keys(files).forEach(name => {
        // Sidebar Item
        const item = document.createElement('div');
        item.className = `file-item ${name === currentFileName ? 'active' : ''}`;
        item.innerHTML = `
            <span>${getFileIcon(name)} ${name}</span>
            <span class="del-btn" onclick="deleteFile('${name}', event)">×</span>
        `;
        item.onclick = () => switchFile(name);
        fileList.appendChild(item);

        // Tab Item (Active only or all? Let's show active + generic)
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

// --- Execution Logic ---

function runCode() {
    saveCurrentFile();
    clearOutput();
    clearErrorMarkers();
    
    const file = files[currentFileName];
    const mode = document.getElementById('langSelect').value;

    if (mode === 'web' || currentFileName.endsWith('.html')) {
        // Web Mode
        outputDiv.style.display = 'none';
        previewFrame.style.display = 'block';
        previewFrame.srcdoc = editor.getValue();
        log("Web Preview Updated.", 'log-info');
    } else {
        // Python / JS
        outputDiv.style.display = 'block';
        previewFrame.style.display = 'none';
        
        if (mode === 'python') {
            if (!isWorkerReady) { log("⏳ Engine loading...", 'log-warn'); return; }
            setRunning(true);
            
            // 重要: 全てのファイルをWorkerの仮想ファイルシステムに書き込む
            const fileData = {};
            for (let f in files) {
                fileData[f] = files[f].content;
            }

            // ライブラリ検知
            const code = editor.getValue();
            const packages = [];
            if(code.includes('import pandas') || code.includes('from pandas')) packages.push('pandas');
            if(code.includes('import numpy') || code.includes('from numpy')) packages.push('numpy');
            if(code.includes('import matplotlib') || code.includes('from matplotlib')) packages.push('matplotlib');
            if(code.includes('import scipy') || code.includes('from scipy')) packages.push('scipy');

            worker.postMessage({ 
                cmd: 'run', 
                code: code, 
                files: fileData, // 全ファイル送信
                packages: packages 
            });

        } else if (mode === 'javascript') {
            // Node-like JS execution
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
        log("⛔ Stopped by user.", 'log-err');
        initWorker(); // Restart
    }
    setRunning(false);
}

// --- Utils ---

function log(msg, cls) {
    const d = document.createElement('div');
    d.textContent = msg;
    if(cls) d.className = cls;
    outputDiv.appendChild(d);
    scrollToBottom();
}

function scrollToBottom() {
    outputDiv.scrollTop = outputDiv.scrollHeight;
}

function clearOutput() {
    outputDiv.innerHTML = "";
    if(previewFrame.contentWindow) previewFrame.srcdoc = "";
}

function setRunning(state) {
    runBtn.style.display = state ? 'none' : 'inline-flex';
    stopBtn.style.display = state ? 'inline-flex' : 'none';
    statusSpan.textContent = state ? "Running..." : "Ready";
}

function updateStatus(msg, color) {
    statusSpan.textContent = msg;
    statusSpan.style.color = color;
}

// 全角スペース検知
const Range = ace.require("ace/range").Range;
let zenkakuMarkers = [];
function checkZenkaku() {
    const session = editor.getSession();
    zenkakuMarkers.forEach(id => session.removeMarker(id));
    zenkakuMarkers = [];
    const lines = session.getDocument().getAllLines();
    lines.forEach((line, row) => {
        for(let col=0; col<line.length; col++){
            if(line[col] === '\u3000'){
                zenkakuMarkers.push(session.addMarker(new Range(row,col,row,col+1), "zenkaku-space", "text"));
            }
        }
    });
}
editor.on('change', checkZenkaku);

// エラーハイライト
let errMarkers = [];
function highlightError(line) {
    const session = editor.getSession();
    errMarkers.push(session.addMarker(new Range(line-1, 0, line-1, 100), "ace_error-line", "fullLine"));
    editor.scrollToLine(line-1, true, true, function(){});
}
function clearErrorMarkers() {
    const session = editor.getSession();
    errMarkers.forEach(id => session.removeMarker(id));
    errMarkers = [];
}

// --- Resizer Logic ---
let isResizing = false;
resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.style.cursor = 'row-resize';
});
document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const h = window.innerHeight - e.clientY;
    if (h > 50 && h < window.innerHeight - 100) {
        terminalPane.style.height = h + 'px';
    }
});
document.addEventListener('mouseup', () => {
    isResizing = false;
    document.body.style.cursor = 'default';
    editor.resize(); // Ace Editorのリサイズ補正
});

// Sidebar Toggle
function toggleSidebar() {
    sidebar.classList.toggle('open');
    if(window.innerWidth > 768) {
        sidebar.style.width = sidebar.style.width === '0px' ? '200px' : '0px';
    }
    setTimeout(() => editor.resize(), 200);
}

// Format Code (簡易版)
function formatCode() {
    const val = editor.getValue();
    // 簡易的な行末空白削除など
    const formatted = val.split('\n').map(l => l.trimRight()).join('\n');
    editor.setValue(formatted, -1);
}

// Download
function downloadFile() {
    const blob = new Blob([editor.getValue()], {type: 'text/plain'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = currentFileName;
    a.click();
}

function changeLanguage() {
    // Dropdown change logic handled mostly by file switching, 
    // but can be used to force mode
    const val = document.getElementById('langSelect').value;
    if(val === 'web') {
        if(!files['index.html']) {
             files['index.html'] = { content: DEFAULT_FILES['index.html'].content, mode: 'html' };
             renderExplorer();
        }
        switchFile('index.html');
    }
}

// 初期化
switchFile(currentFileName);
setTimeout(checkZenkaku, 500);

// ショートカット
document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault(); runCode();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault(); saveCurrentFile();
    }
});

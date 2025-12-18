// --- Service Worker ---
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// --- Monaco Setup ---
require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }});
window.MonacoEnvironment = {
    getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(`
        self.MonacoEnvironment = { baseUrl: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/' };
        importScripts('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/base/worker/workerMain.js');`
    )}`
};

// --- State ---
let editor;
let files = {};
let currentPath = "";
let expandedFolders = new Set(); // 開いているフォルダのセット
let dragSrcPath = null; // D&D用

// Sample Data
const DEFAULT_FILES = {
    'main.py': { content: `import sys\nimport utils.helper as h\n\nprint(f"🐍 Python {sys.version.split()[0]}")\nprint(h.msg())`, mode: 'python' },
    'utils/helper.py': { content: `def msg():\n    return "Nested Import Works!"`, mode: 'python' },
    'index.html': { content: `<!DOCTYPE html>\n<html>\n<head>\n  <link rel="stylesheet" href="css/style.css">\n</head>\n<body>\n  <h1>Drag & Drop Supported</h1>\n  <script src="js/main.js"></script>\n</body>\n</html>`, mode: 'html' },
    'css/style.css': { content: `body { background: #222; color: #fff; text-align: center; padding: 50px; }`, mode: 'css' },
    'js/main.js': { content: `console.log("JS Loaded");`, mode: 'javascript' }
};

// --- Init ---
try {
    files = JSON.parse(localStorage.getItem('pypanel_files')) || DEFAULT_FILES;
} catch(e) { files = DEFAULT_FILES; }

require(['vs/editor/editor.main'], function() {
    currentPath = Object.keys(files)[0] || "main.py";
    
    editor = monaco.editor.create(document.getElementById('editor-container'), {
        value: files[currentPath] ? files[currentPath].content : "",
        language: getLang(currentPath),
        theme: 'vs-dark',
        fontSize: 14,
        automaticLayout: true,
        minimap: { enabled: true, scale: 0.75 },
        fontFamily: "'JetBrains Mono', monospace",
        padding: { top: 10 }
    });

    editor.onDidChangeModelContent(() => {
        if(files[currentPath]) {
            files[currentPath].content = editor.getValue();
            saveFiles();
        }
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, runProject);
    
    // 初期フォルダ展開 (ルート直下のフォルダは開いておく)
    Object.keys(files).forEach(p => {
        const parts = p.split('/');
        if(parts.length > 1) expandedFolders.add(parts[0]);
    });
    
    renderTree();
    updateTabs();
});

function saveFiles() {
    localStorage.setItem('pypanel_files', JSON.stringify(files));
}

// --- Hierarchical File System & D&D ---

function renderTree() {
    const tree = document.getElementById('file-tree');
    tree.innerHTML = "";
    
    // フラットなパスを階層オブジェクトに変換
    const structure = {};
    Object.keys(files).sort().forEach(path => {
        const parts = path.split('/');
        let current = structure;
        parts.forEach((part, i) => {
            if (!current[part]) {
                current[part] = (i === parts.length - 1) ? { __file: true, path: path } : {};
            }
            current = current[part];
        });
    });

    // 再帰的にDOM生成
    function buildDom(obj, container, fullPathPrefix = "") {
        Object.keys(obj).sort((a,b) => {
            // フォルダ優先
            const aIsFile = obj[a].__file;
            const bIsFile = obj[b].__file;
            if (aIsFile === bIsFile) return a.localeCompare(b);
            return aIsFile ? 1 : -1;
        }).forEach(key => {
            if (key === '__file' || key === 'path') return;
            
            const item = obj[key];
            const isFile = item.__file;
            const currentFullPath = fullPathPrefix ? `${fullPathPrefix}/${key}` : key;
            
            const node = document.createElement('div');
            node.className = 'tree-node';
            
            // Content Row
            const content = document.createElement('div');
            content.className = `tree-content ${isFile && item.path === currentPath ? 'active' : ''}`;
            
            // Drag Events
            content.draggable = true;
            content.ondragstart = (e) => dragStart(e, currentFullPath);
            content.ondragover = (e) => dragOver(e, isFile);
            content.ondragleave = (e) => dragLeave(e);
            content.ondrop = (e) => drop(e, currentFullPath, isFile);

            // Icon & Name
            let iconHtml = '';
            if (isFile) {
                iconHtml = `<span class="file-spacer"></span>${getIcon(key)}`;
            } else {
                const isOpen = expandedFolders.has(currentFullPath);
                iconHtml = `<span class="arrow ${isOpen ? 'down' : ''}">▶</span>📁`;
            }
            
            content.innerHTML = `${iconHtml} <span style="margin-left:5px;">${key}</span>`;
            
            // Click Events
            content.onclick = (e) => {
                e.stopPropagation();
                if (isFile) {
                    openFile(item.path);
                } else {
                    toggleFolder(currentFullPath);
                }
            };
            content.oncontextmenu = (e) => showCtx(e, currentFullPath, isFile);

            node.appendChild(content);

            // Children Container (for folders)
            if (!isFile) {
                const childrenDiv = document.createElement('div');
                childrenDiv.className = `tree-children ${expandedFolders.has(currentFullPath) ? 'open' : ''}`;
                buildDom(item, childrenDiv, currentFullPath);
                node.appendChild(childrenDiv);
            }

            container.appendChild(node);
        });
    }

    buildDom(structure, tree);
}

function toggleFolder(path) {
    if(expandedFolders.has(path)) expandedFolders.delete(path);
    else expandedFolders.add(path);
    renderTree();
}

// --- Drag & Drop Logic ---

function dragStart(e, path) {
    dragSrcPath = path;
    e.dataTransfer.effectAllowed = 'move';
    e.target.classList.add('dragging');
}

function dragOver(e, isTargetFile) {
    e.preventDefault(); // allow drop
    // ファイルの上にはドロップできない（フォルダにのみドロップ可）
    // ただし、ルートへの移動などはUIが複雑になるため、今回は「フォルダの上」のみハイライト
    if (!isTargetFile) {
        e.currentTarget.classList.add('drag-over');
    }
}

function dragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

function drop(e, targetPath, isTargetFile) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    
    if (!dragSrcPath || dragSrcPath === targetPath) return;
    if (isTargetFile) return; // フォルダの中にしか入れられない

    // 移動処理
    // targetPath (フォルダ) の中に dragSrcPath (ファイルorフォルダ) を移動
    
    // ループ防止 (自分を自分の子フォルダに移動できない)
    if (targetPath.startsWith(dragSrcPath + '/')) {
        alert("Cannot move folder into itself.");
        return;
    }

    const fileName = dragSrcPath.split('/').pop();
    const newPath = `${targetPath}/${fileName}`;
    
    if (files[newPath] || Object.keys(files).some(k => k.startsWith(newPath + '/'))) {
        if(!confirm(`Overwrite ${newPath}?`)) return;
    }

    moveEntry(dragSrcPath, newPath);
    renderTree();
}

function moveEntry(oldP, newP) {
    // ファイル単体の場合
    if (files[oldP]) {
        files[newP] = files[oldP];
        delete files[oldP];
        if (currentPath === oldP) {
            currentPath = newP;
            updateTabs();
        }
    } else {
        // フォルダの場合、配下のファイルをすべてリネーム
        Object.keys(files).forEach(k => {
            if (k.startsWith(oldP + '/')) {
                const suffix = k.substring(oldP.length);
                const dest = newP + suffix;
                files[dest] = files[k];
                delete files[k];
                if (currentPath === k) {
                    currentPath = dest;
                    updateTabs();
                }
            }
        });
    }
    saveFiles();
}


// --- File Ops ---
function openFile(path) {
    currentPath = path;
    const model = editor.getModel();
    monaco.editor.setModelLanguage(model, getLang(path));
    editor.setValue(files[path].content);
    renderTree();
    updateTabs();
}

function createNewFile() {
    // 選択中のフォルダがあればその下に作るなどのロジックも可だが、今回はシンプルに
    let path = prompt("New File Path (e.g. src/app.js):", "");
    if(!path) return;
    if(files[path]) return;
    files[path] = { content: "", mode: getLang(path) };
    saveFiles();
    // 親フォルダを展開リストに追加
    const parts = path.split('/');
    if(parts.length > 1) {
        let acc = "";
        for(let i=0; i<parts.length-1; i++){
            acc += (acc?"/":"") + parts[i];
            expandedFolders.add(acc);
        }
    }
    renderTree();
    openFile(path);
}

function createNewFolder() {
    let path = prompt("New Folder Name:", "folder");
    if(!path) return;
    // 仮想FSなのでファイルがないとフォルダは消える。
    // .keep ファイルを作ってフォルダを維持する
    files[`${path}/.keep`] = { content: "", mode: "plaintext" };
    expandedFolders.add(path);
    saveFiles();
    renderTree();
}

function getLang(p) {
    if(p.endsWith('.py')) return 'python';
    if(p.endsWith('.js')) return 'javascript';
    if(p.endsWith('.html')) return 'html';
    if(p.endsWith('.css')) return 'css';
    if(p.endsWith('.rb')) return 'ruby';
    return 'plaintext';
}
function getIcon(p) {
    if(p.endsWith('.py')) return '🐍';
    if(p.endsWith('.js')) return '📜';
    if(p.endsWith('.html')) return '🌐';
    if(p.endsWith('.css')) return '🎨';
    return '📄';
}
function updateTabs() {
    document.getElementById('tabs').innerHTML = `<div class="tab active">${currentPath}</div>`;
}

// --- Context Menu ---
const ctxMenu = document.getElementById('context-menu');
let ctxTarget = null;
let ctxIsFile = true;
function showCtx(e, path, isFile) {
    e.preventDefault();
    ctxTarget = path;
    ctxIsFile = isFile;
    ctxMenu.style.display = 'block';
    ctxMenu.style.left = e.pageX + 'px';
    ctxMenu.style.top = e.pageY + 'px';
}
document.addEventListener('click', () => ctxMenu.style.display = 'none');

function ctxDelete() {
    if(ctxTarget && confirm(`Delete ${ctxTarget}?`)) {
        if(ctxIsFile) {
            delete files[ctxTarget];
        } else {
            // フォルダ削除 (配下すべて)
            Object.keys(files).forEach(k => {
                if(k.startsWith(ctxTarget + '/')) delete files[k];
            });
        }
        if(!files[currentPath]) currentPath = Object.keys(files)[0] || "";
        if(currentPath) openFile(currentPath);
        else editor.setValue("");
        saveFiles();
        renderTree();
    }
}
function ctxRename() {
    if(!ctxTarget) return;
    const newName = prompt("Rename to:", ctxTarget);
    if(newName && newName !== ctxTarget) {
        moveEntry(ctxTarget, newName);
        renderTree();
    }
}
function ctxRun() {
    if(ctxIsFile) {
        openFile(ctxTarget);
        runProject();
    }
}


// --- Project Runner ---
async function runProject() {
    // 1. Python
    if (currentPath.endsWith('.py')) {
        switchPanel('terminal');
        runPython();
        return;
    }
    // 2. Web (Auto Bundle)
    // index.html または 現在のHTML
    let entry = files['index.html'] ? 'index.html' : (currentPath.endsWith('.html') ? currentPath : null);
    
    if (entry) {
        switchPanel('preview');
        log(`Bundling Web Project from ${entry}...`, '#4ec9b0');
        const html = bundleFiles(entry);
        document.getElementById('preview-frame').srcdoc = html;
        return;
    }
    
    log("Cannot run this file type directly.", 'orange');
}

function bundleFiles(htmlPath) {
    let html = files[htmlPath].content;
    // Replace <link href="..."> -> <style>...</style>
    html = html.replace(/<link\s+[^>]*href=["']([^"']+)["'][^>]*>/g, (m, href) => {
        if(files[href]) return `<style>/* ${href} */\n${files[href].content}</style>`;
        return m;
    });
    // Replace <script src="..."> -> <script>...</script>
    html = html.replace(/<script\s+[^>]*src=["']([^"']+)["'][^>]*><\/script>/g, (m, src) => {
        if(files[src]) return `<script>/* ${src} */\n${files[src].content}</script>`;
        return m;
    });
    return html;
}

// --- Python Engine ---
let pyWorker = null;
function runPython() {
    if(!pyWorker) {
        log("Starting Python Engine...", 'gray');
        pyWorker = new Worker('py-worker.js');
        pyWorker.onmessage = e => {
            const d = e.data;
            if(d.type==='stdout') log(d.text);
            if(d.type==='results') log("<= " + d.results, '#4ec9b0');
            if(d.type==='error') log("Error: "+d.error, 'red');
        };
    }
    const fileData = {};
    for(let f in files) fileData[f] = files[f].content;
    pyWorker.postMessage({ cmd: 'run', code: files[currentPath].content, files: fileData });
}

// --- Terminal / Utils ---
const termLog = document.getElementById('term-log');
const shellIn = document.getElementById('shell-input');
shellIn.addEventListener('keydown', e => {
    if(e.key === 'Enter') {
        const val = shellIn.value;
        log(`$ ${val}`, '#888');
        shellIn.value = "";
        if(val === 'ls') log(Object.keys(files).join('\n'));
        else if(val === 'clear') termLog.innerHTML = "";
        else log("Command not found");
    }
});

function log(msg, color) {
    const d = document.createElement('div');
    d.textContent = msg;
    if(color) d.style.color = color;
    termLog.appendChild(d);
    document.getElementById('output').scrollTop = 99999;
}
function clearOutput() { termLog.innerHTML = ""; }
function resetAll() {
    if(confirm("Factory Reset?")) { localStorage.removeItem('pypanel_files'); location.reload(); }
}

function switchPanel(p) {
    document.getElementById('tab-term').classList.remove('active');
    document.getElementById('tab-prev').classList.remove('active');
    document.getElementById('terminal-area').className = p === 'terminal' ? 'show' : '';
    document.getElementById('preview-area').className = p === 'preview' ? 'show' : '';
    if(p === 'terminal') document.getElementById('tab-term').classList.add('active');
    else document.getElementById('tab-prev').classList.add('active');
}

function openPopup() {
    document.getElementById('popup-overlay').style.display = 'flex';
    if(files['index.html']) document.getElementById('popup-content').srcdoc = bundleFiles('index.html');
}
function closePopup() { document.getElementById('popup-overlay').style.display = 'none'; }

function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const isClosed = sb.style.transform === 'translateX(-100%)';
    sb.style.transform = isClosed ? 'translateX(0)' : 'translateX(-100%)';
    if(window.innerWidth > 768) sb.style.width = isClosed ? '240px' : '0px';
    setTimeout(() => editor.layout(), 250);
}

// Touch Resizer
const resizer = document.getElementById('resizer');
const bottomPanel = document.getElementById('bottom-panel');
function handleDrag(e) {
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const h = window.innerHeight - clientY;
    if(h > 50 && h < window.innerHeight - 50) {
        bottomPanel.style.height = h + 'px';
        editor.layout();
    }
}
resizer.addEventListener('mousedown', () => document.addEventListener('mousemove', handleDrag));
document.addEventListener('mouseup', () => document.removeEventListener('mousemove', handleDrag));
resizer.addEventListener('touchstart', () => document.addEventListener('touchmove', handleDrag, {passive:false}), {passive:false});
document.addEventListener('touchend', () => document.removeEventListener('touchmove', handleDrag));

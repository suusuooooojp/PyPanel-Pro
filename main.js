// --- Service Worker ---
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// --- Monaco Setup ---
require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }});
window.MonacoEnvironment = { getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(`self.MonacoEnvironment = { baseUrl: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/' }; importScripts('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/base/worker/workerMain.js');`)}` };

// --- State ---
let editor;
let files = {};
let currentPath = "";
let expandedFolders = new Set();
let openedFiles = []; // Tabs
let dragSrc = null;

// --- Init Data ---
const DEFAULT_FILES = {
    'main.py': { content: `import sys\nprint(f"Python {sys.version.split()[0]}")`, mode: 'python' },
    'index.html': { content: `<!DOCTYPE html>\n<html>\n<body>\n<h1>Hello VS Code Style</h1>\n<script src="js/app.js"></script>\n</body>\n</html>`, mode: 'html' },
    'js/app.js': { content: `console.log("App Loaded");`, mode: 'javascript' },
    'css/style.css': { content: `body { background: #fff; }`, mode: 'css' }
};

try { files = JSON.parse(localStorage.getItem('pypanel_files')) || DEFAULT_FILES; } catch(e) { files = DEFAULT_FILES; }

// --- Editor Init ---
require(['vs/editor/editor.main'], function() {
    currentPath = Object.keys(files)[0] || "main.py";
    openedFiles = [currentPath];

    editor = monaco.editor.create(document.getElementById('editor-container'), {
        value: files[currentPath] ? files[currentPath].content : "",
        language: getLang(currentPath),
        theme: 'vs-dark',
        fontSize: 14,
        automaticLayout: true,
        minimap: { enabled: true, scale: 0.75 },
        fontFamily: "'JetBrains Mono', monospace",
        padding: { top: 10 },
        scrollBeyondLastLine: false,
    });

    document.getElementById('loading-screen').style.display = 'none';

    // Events
    editor.onDidChangeModelContent(() => {
        if(files[currentPath]) {
            files[currentPath].content = editor.getValue();
            saveFiles();
        }
    });
    
    editor.onDidChangeCursorPosition((e) => {
        document.getElementById('cursor-pos').innerText = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, runProject);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveFiles);

    // Initial Tree
    Object.keys(files).forEach(p => {
        const parts = p.split('/');
        if(parts.length > 1) expandedFolders.add(parts[0]);
    });

    renderTree();
    renderTabs();
});

// --- File System UI (Recursive Tree) ---
function renderTree() {
    const tree = document.getElementById('file-tree');
    tree.innerHTML = "";
    
    // Build Hierarchy
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

    function buildDom(obj, container, prefix = "", level = 0) {
        // Sort: Folders first
        Object.keys(obj).sort((a,b) => {
            const aIsFile = obj[a].__file;
            const bIsFile = obj[b].__file;
            if (aIsFile === bIsFile) return a.localeCompare(b);
            return aIsFile ? 1 : -1;
        }).forEach(key => {
            if (key === '__file' || key === 'path') return;
            const item = obj[key];
            const isFile = item.__file;
            const fullPath = prefix ? `${prefix}/${key}` : key;
            const padding = level * 12 + 10;

            const node = document.createElement('div');
            node.className = 'tree-node';
            
            const content = document.createElement('div');
            content.className = `tree-content ${isFile && fullPath === currentPath ? 'active' : ''}`;
            content.style.paddingLeft = padding + 'px';
            content.draggable = true;

            // Icon
            let iconStr = isFile ? getIcon(key) : (expandedFolders.has(fullPath) ? '📂' : '📁');
            let arrowStr = isFile ? '<span style="width:20px;"></span>' : `<span class="tree-arrow ${expandedFolders.has(fullPath)?'open':''}">▶</span>`;

            content.innerHTML = `${arrowStr}<span class="tree-icon">${iconStr}</span><span class="tree-name">${key}</span><span class="tree-menu">⋮</span>`;
            
            // Events
            content.onclick = (e) => {
                e.stopPropagation();
                if(isFile) openFile(item.path); else toggleFolder(fullPath);
            };
            content.oncontextmenu = (e) => showCtx(e, fullPath, isFile);
            content.querySelector('.tree-menu').onclick = (e) => {
                e.stopPropagation(); showCtx(e, fullPath, isFile);
            }

            // D&D
            content.ondragstart = (e) => { dragSrc = fullPath; e.dataTransfer.effectAllowed = 'move'; };
            content.ondragover = (e) => { e.preventDefault(); if(!isFile) content.classList.add('drag-over'); };
            content.ondragleave = (e) => content.classList.remove('drag-over');
            content.ondrop = (e) => {
                e.preventDefault(); content.classList.remove('drag-over');
                if(!dragSrc || dragSrc === fullPath) return;
                moveEntry(dragSrc, fullPath + "/" + dragSrc.split('/').pop());
            };

            node.appendChild(content);

            if(!isFile && expandedFolders.has(fullPath)) {
                const children = document.createElement('div');
                buildDom(item, children, fullPath, level + 1);
                node.appendChild(children);
            }
            container.appendChild(node);
        });
    }
    buildDom(structure, tree);
}

function toggleFolder(p) {
    if(expandedFolders.has(p)) expandedFolders.delete(p); else expandedFolders.add(p);
    renderTree();
}

function openFile(p) {
    if(!files[p]) return;
    currentPath = p;
    if(!openedFiles.includes(p)) openedFiles.push(p);
    
    monaco.editor.setModelLanguage(editor.getModel(), getLang(p));
    editor.setValue(files[p].content);
    renderTree();
    renderTabs();
}

function closeFile(p) {
    openedFiles = openedFiles.filter(f => f !== p);
    if(currentPath === p) {
        if(openedFiles.length > 0) openFile(openedFiles[0]);
        else { currentPath = ""; editor.setValue(""); }
    }
    renderTabs();
}

function renderTabs() {
    const el = document.getElementById('tabs');
    el.innerHTML = "";
    openedFiles.forEach(p => {
        const div = document.createElement('div');
        div.className = `tab ${p === currentPath ? 'active' : ''}`;
        div.innerHTML = `<span class="tab-name">${p.split('/').pop()}</span><span class="tab-close">×</span>`;
        div.onclick = () => openFile(p);
        div.querySelector('.tab-close').onclick = (e) => { e.stopPropagation(); closeFile(p); };
        el.appendChild(div);
    });
}

// --- Menu Actions (Fixed Rename/Move) ---
const ctxMenu = document.getElementById('context-menu');
let ctxTarget = null, ctxIsFile = true;

function showCtx(e, p, f) {
    e.preventDefault(); ctxTarget = p; ctxIsFile = f;
    let x = e.pageX, y = e.pageY;
    const r = ctxMenu.getBoundingClientRect();
    if(x+160 > window.innerWidth) x -= 160;
    if(y+100 > window.innerHeight) y -= 100;
    ctxMenu.style.left = x+'px'; ctxMenu.style.top = y+'px';
    ctxMenu.style.display = 'block';
}
document.addEventListener('click', () => ctxMenu.style.display = 'none');
if(editor) editor.onMouseDown(() => ctxMenu.style.display = 'none');

function ctxRename() {
    const oldName = ctxTarget.split('/').pop();
    const newName = prompt("Rename to:", oldName);
    if(!newName || newName === oldName) return;
    
    // Calculate new path properly
    const parent = ctxTarget.substring(0, ctxTarget.lastIndexOf('/'));
    const newPath = parent ? `${parent}/${newName}` : newName;
    
    moveEntry(ctxTarget, newPath);
}

function ctxMove() {
    const dest = prompt("Move to folder (leave empty for root):", "");
    if(dest === null) return;
    
    const d = dest.trim().replace(/\/$/, ""); // Remove trailing slash
    const fileName = ctxTarget.split('/').pop();
    const newPath = d ? `${d}/${fileName}` : fileName;
    
    if(newPath === ctxTarget) return;
    moveEntry(ctxTarget, newPath);
}

function moveEntry(oldP, newP) {
    if(files[oldP]) {
        // Simple File Move
        if(files[newP]) { alert("File exists!"); return; }
        files[newP] = files[oldP];
        delete files[oldP];
        
        // Update Tabs
        const idx = openedFiles.indexOf(oldP);
        if(idx !== -1) openedFiles[idx] = newP;
        if(currentPath === oldP) currentPath = newP;
        
    } else {
        // Folder Move/Rename: Rename all files starting with oldP/
        const keys = Object.keys(files).filter(k => k.startsWith(oldP + '/'));
        if(keys.length === 0) return; // Empty folder (virtual)
        
        keys.forEach(k => {
            const suffix = k.substring(oldP.length);
            const dest = newP + suffix;
            files[dest] = files[k];
            delete files[k];
            
            const idx = openedFiles.indexOf(k);
            if(idx !== -1) openedFiles[idx] = dest;
            if(currentPath === k) currentPath = dest;
        });
        
        // Update expanded folders logic
        if(expandedFolders.has(oldP)) {
            expandedFolders.delete(oldP);
            expandedFolders.add(newP);
        }
    }
    saveFiles();
    renderTree();
    renderTabs();
}

function ctxDelete() {
    if(!confirm("Delete " + ctxTarget + "?")) return;
    if(files[ctxTarget]) {
        delete files[ctxTarget];
        closeFile(ctxTarget);
    } else {
        // Folder delete
        Object.keys(files).forEach(k => {
            if(k.startsWith(ctxTarget + '/')) {
                delete files[k];
                closeFile(k);
            }
        });
    }
    saveFiles();
    renderTree();
}

function ctxRun() {
    if(ctxIsFile) { openFile(ctxTarget); runProject(); }
}

function createNewFile() {
    let name = prompt("File Name (e.g. script.py):", "");
    if(!name) return;
    // Default extension if missing
    if(!name.includes('.')) name += ".txt";
    
    if(files[name]) { alert("Exists"); return; }
    files[name] = { content: "", mode: getLang(name) };
    saveFiles(); renderTree(); openFile(name);
}

function createNewFolder() {
    const name = prompt("Folder Name:", "new_folder");
    if(!name) return;
    // Create a dummy file to hold the folder
    files[`${name}/.keep`] = { content: "", mode: "plaintext" };
    expandedFolders.add(name);
    saveFiles(); renderTree();
}

// --- Utils ---
function saveFiles() { localStorage.setItem('pypanel_files', JSON.stringify(files)); }
function getLang(p) { return p.endsWith('.py')?'python':(p.endsWith('.js')?'javascript':(p.endsWith('.html')?'html':(p.endsWith('.css')?'css':'plaintext'))); }
function getIcon(p) {
    if(p.endsWith('.py')) return '🐍';
    if(p.endsWith('.js')) return '📜';
    if(p.endsWith('.html')) return '🌐';
    if(p.endsWith('.css')) return '🎨';
    return '📄';
}

// --- Runner ---
async function runProject() {
    if(currentPath.endsWith('.py')) {
        switchPanel('terminal');
        runPython();
    } else if(currentPath.match(/\.(html|js|css)$/)) {
        switchPanel('preview');
        // If index.html exists, use it. Else use current if html
        let entry = files['index.html'] ? 'index.html' : (currentPath.endsWith('.html') ? currentPath : null);
        if(entry) {
            document.getElementById('preview-frame').srcdoc = bundleFiles(entry);
        } else {
            document.getElementById('preview-frame').srcdoc = "No index.html found.";
        }
    }
}

function bundleFiles(path) {
    let html = files[path].content;
    html = html.replace(/<link\s+href=["']([^"']+)["'][^>]*>/g, (m, h) => files[h] ? `<style>${files[h].content}</style>` : m);
    html = html.replace(/<script\s+src=["']([^"']+)["'][^>]*><\/script>/g, (m, s) => files[s] ? `<script>${files[s].content}</script>` : m);
    return html;
}

// --- Python Worker ---
let pyWorker = null;
function initPyWorker() {
    document.getElementById('py-status-text').innerText = "Loading";
    pyWorker = new Worker('py-worker.js');
    pyWorker.onmessage = (e) => {
        const d = e.data;
        if(d.type === 'ready') document.getElementById('py-status-text').innerText = "Ready";
        else if(d.type === 'stdout') termLog(d.text);
        else if(d.type === 'error') termLog(d.error, 'red');
        else if(d.type === 'results') termLog("Done.");
    };
}
initPyWorker();

function runPython() {
    const d = {};
    for(let f in files) d[f] = files[f].content;
    pyWorker.postMessage({ cmd: 'run', code: files[currentPath].content, files: d });
}

// --- Terminal ---
const termOut = document.getElementById('term-log');
const shellInput = document.getElementById('shell-input');
shellInput.addEventListener('keydown', e => {
    if(e.key === 'Enter') {
        const val = shellInput.value;
        termLog(`$ ${val}`, '#888');
        shellInput.value = "";
        // Simple commands
        if(val === 'ls') termLog(Object.keys(files).join('\n'));
        else if(val === 'clear') termOut.innerHTML = "";
    }
});
function termLog(msg, color) {
    const d = document.createElement('div');
    d.textContent = msg; if(color) d.style.color = color;
    termOut.appendChild(d);
    document.getElementById('output').scrollTop = 99999;
}
function clearOutput() { termOut.innerHTML = ""; }

// --- Layout ---
function switchPanel(mode) {
    document.getElementById('terminal-area').className = mode === 'terminal' ? 'show' : '';
    document.getElementById('preview-area').className = mode === 'preview' ? 'show' : '';
    document.getElementById('tab-term').className = mode === 'terminal' ? 'panel-tab active' : 'panel-tab';
    document.getElementById('tab-prev').className = mode === 'preview' ? 'panel-tab active' : 'panel-tab';
}
function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const isMobile = window.innerWidth <= 768;
    if(isMobile) sb.classList.toggle('open');
    else sb.classList.toggle('collapsed');
    setTimeout(() => editor.layout(), 250);
}
function toggleTerminal() {
    const p = document.getElementById('bottom-panel');
    p.style.display = p.style.display === 'none' ? 'flex' : 'none';
    editor.layout();
}
function resetAll() {
    if(confirm("Reset Everything?")) { localStorage.removeItem('pypanel_files'); location.reload(); }
}
function openPopup() {
    document.getElementById('popup-overlay').style.display = 'flex';
    if(files['index.html']) document.getElementById('popup-content').srcdoc = bundleFiles('index.html');
}

// --- Resizer ---
const resizerH = document.getElementById('resizer-h');
const bPanel = document.getElementById('bottom-panel');
resizerH.addEventListener('mousedown', initResize);
resizerH.addEventListener('touchstart', initResize, {passive:false});

function initResize(e) {
    e.preventDefault();
    document.addEventListener('mousemove', doResize);
    document.addEventListener('touchmove', doResize, {passive:false});
    document.addEventListener('mouseup', stopResize);
    document.addEventListener('touchend', stopResize);
}
function doResize(e) {
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const h = window.innerHeight - clientY - 24; // Status bar
    if(h > 30 && h < window.innerHeight - 100) {
        bPanel.style.height = h + 'px';
        editor.layout();
    }
}
function stopResize() {
    document.removeEventListener('mousemove', doResize);
    document.removeEventListener('touchmove', doResize);
    document.removeEventListener('mouseup', stopResize);
    document.removeEventListener('touchend', stopResize);
}

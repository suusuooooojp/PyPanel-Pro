// --- Service Worker ---
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// --- System Monitor ---
let lastMonitorUpdate = 0, lastLoop = Date.now();
function updateMonitor() {
    const now = Date.now(), delta = now - lastLoop; lastLoop = now;
    if (now - lastMonitorUpdate > 2000) {
        lastMonitorUpdate = now;
        const fps = Math.round(1000 / (delta || 1));
        let load = Math.max(0, 100 - (fps / 60 * 100)); 
        document.getElementById('cpu-val').innerText = Math.round(load > 100 ? 100 : load) + "%";
        
        const memEl = document.getElementById('mem-val');
        if(performance && performance.memory) {
            memEl.innerText = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) + "MB";
        } else {
            // Estimate for Safari/Firefox
            let size = 0; Object.values(files).forEach(f => size += f.content.length);
            memEl.innerText = "~" + Math.round(20 + size/1024) + "MB";
        }
    }
    requestAnimationFrame(updateMonitor);
}
requestAnimationFrame(updateMonitor);

// --- Zoom ---
let currentZoom = 1.0;
function changeZoom(d) {
    currentZoom += d;
    if(currentZoom < 0.5) currentZoom = 0.5; if(currentZoom > 2.0) currentZoom = 2.0;
    const w = document.getElementById('app-wrapper');
    w.style.transform = `scale(${currentZoom})`;
    w.style.width = `${100/currentZoom}%`; w.style.height = `${100/currentZoom}%`;
    if(editor) editor.layout();
}

// --- Layout ---
let isRightPreview = false;
function toggleLayout() {
    isRightPreview = !isRightPreview;
    const rPane = document.getElementById('right-preview-pane');
    const rV = document.getElementById('resizer-v');
    const bTab = document.getElementById('tab-prev');
    if(isRightPreview) {
        rPane.classList.add('show'); rV.style.display = 'flex';
        bTab.style.display = 'none'; switchPanel('terminal');
    } else {
        rPane.classList.remove('show'); rV.style.display = 'none';
        bTab.style.display = 'flex';
    }
    if(editor) setTimeout(() => editor.layout(), 100);
}
function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const isMobile = window.innerWidth <= 768;
    if(isMobile) sb.classList.toggle('open'); else sb.classList.toggle('collapsed');
    setTimeout(() => editor.layout(), 250);
}

// --- Monaco Setup ---
require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }});
window.MonacoEnvironment = { getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(`self.MonacoEnvironment = { baseUrl: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/' }; importScripts('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/base/worker/workerMain.js');`)}` };

let editor, files = {}, currentPath = "", expandedFolders = new Set(), openedFiles = [], dragSrc = null;

const DEFAULT_FILES = {
    'main.py': { content: `import sys\nimport math\n\n# Ctrl+Space for Autocomplete\nprint(f"Python {sys.version.split()[0]}")\nprint(math.pi)`, mode: 'python' },
    'index.html': { content: `<html><body><h1>Hello PyPanel</h1></body></html>`, mode: 'html' }
};

try { files = JSON.parse(localStorage.getItem('pypanel_files')) || DEFAULT_FILES; } catch(e) { files = DEFAULT_FILES; }

require(['vs/editor/editor.main'], function() {
    // ★ Python Autocomplete Registration ★
    registerPythonFeatures();

    currentPath = Object.keys(files)[0] || "main.py";
    openedFiles = [currentPath];

    editor = monaco.editor.create(document.getElementById('editor-container'), {
        value: files[currentPath] ? files[currentPath].content : "",
        language: getLang(currentPath),
        theme: 'vs-dark',
        fontSize: 14,
        automaticLayout: true,
        minimap: { enabled: true },
        padding: { top: 10 },
        scrollBeyondLastLine: false
    });

    document.getElementById('loading-screen').style.display = 'none';

    editor.onDidChangeModelContent(() => {
        if(files[currentPath]) {
            files[currentPath].content = editor.getValue();
            localStorage.setItem('pypanel_files', JSON.stringify(files));
        }
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, runProject);
    
    Object.keys(files).forEach(p => { const parts = p.split('/'); if(parts.length > 1) expandedFolders.add(parts[0]); });
    renderTree(); renderTabs(); updateFileCount();
});

// ★ Enhanced Python Autocomplete ★
function registerPythonFeatures() {
    monaco.languages.registerCompletionItemProvider('python', {
        provideCompletionItems: function(model, position) {
            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
                startColumn: word.startColumn, endColumn: word.endColumn
            };
            
            const keywords = [
                'import', 'from', 'def', 'class', 'return', 'if', 'else', 'elif', 'while', 'for', 'in', 
                'try', 'except', 'finally', 'with', 'as', 'pass', 'break', 'continue', 'lambda', 
                'global', 'nonlocal', 'True', 'False', 'None', 'and', 'or', 'not', 'is', 'async', 'await'
            ];
            
            const builtins = [
                'print', 'len', 'range', 'open', 'type', 'str', 'int', 'float', 'list', 'dict', 'set', 'tuple', 
                'bool', 'enumerate', 'zip', 'map', 'filter', 'sum', 'min', 'max', 'abs', 'round', 'super', 
                'isinstance', 'input', 'dir', 'help', 'sorted', 'reversed'
            ];
            
            const modules = ['sys', 'os', 'math', 'random', 'datetime', 'json', 're', 'time', 'numpy', 'pandas', 'matplotlib.pyplot'];

            const suggestions = [
                ...keywords.map(k => ({ label: k, kind: monaco.languages.CompletionItemKind.Keyword, insertText: k, range: range })),
                ...builtins.map(k => ({ label: k, kind: monaco.languages.CompletionItemKind.Function, insertText: k, range: range })),
                ...modules.map(k => ({ label: k, kind: monaco.languages.CompletionItemKind.Module, insertText: k, range: range })),
                { label: 'ifmain', kind: monaco.languages.CompletionItemKind.Snippet, insertText: 'if __name__ == "__main__":\n    ${1:pass}', insertTextRules: 4, range: range, documentation: 'Main block' },
                { label: 'def', kind: monaco.languages.CompletionItemKind.Snippet, insertText: 'def ${1:name}(${2:args}):\n    ${3:pass}', insertTextRules: 4, range: range }
            ];
            
            return { suggestions: suggestions };
        }
    });
}

// --- Tabs ---
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
function closeFile(p) {
    openedFiles = openedFiles.filter(f => f !== p);
    if(currentPath === p) {
        if(openedFiles.length > 0) openFile(openedFiles[0]);
        else { currentPath = ""; editor.setValue(""); renderTabs(); }
    } else renderTabs();
}

// --- File System UI ---
function renderTree() {
    const tree = document.getElementById('file-tree');
    tree.innerHTML = "";
    const structure = {};
    Object.keys(files).sort().forEach(path => {
        const parts = path.split('/');
        let current = structure;
        parts.forEach((part, i) => {
            if (!current[part]) current[part] = (i === parts.length - 1) ? { __file: true, path: path } : {};
            current = current[part];
        });
    });

    function buildDom(obj, container, prefix = "") {
        Object.keys(obj).sort((a,b) => {
            const aF = obj[a].__file, bF = obj[b].__file;
            if (aF === bF) return a.localeCompare(b);
            return aF ? 1 : -1;
        }).forEach(key => {
            if(key === '__file' || key === 'path') return;
            const item = obj[key], isFile = item.__file;
            const fullPath = prefix ? `${prefix}/${key}` : key;
            const node = document.createElement('div'); node.className = 'tree-node';
            const content = document.createElement('div');
            content.className = `tree-content ${isFile && item.path === currentPath ? 'active' : ''}`;
            content.draggable = true;
            
            let icon = isFile ? getIcon(key) : (expandedFolders.has(fullPath) ? '📂' : '📁');
            let arrow = isFile ? '' : `<span class="arrow ${expandedFolders.has(fullPath)?'down':''}">▶</span>`;
            
            content.innerHTML = `<span style="width:15px;display:inline-block">${arrow}</span><span style="margin-right:5px;">${icon}</span><span class="tree-name">${key}</span><span class="tree-menu-btn">⋮</span>`;
            
            content.onclick = (e) => { e.stopPropagation(); if(isFile) openFile(item.path); else toggleFolder(fullPath); };
            content.oncontextmenu = (e) => showCtx(e, fullPath, isFile);
            content.querySelector('.tree-menu-btn').onclick = (e) => { e.stopPropagation(); showCtx(e, fullPath, isFile); };
            
            content.ondragstart = (e) => { dragSrc = fullPath; e.dataTransfer.effectAllowed = 'move'; };
            content.ondragover = (e) => { e.preventDefault(); if(!isFile) content.classList.add('drag-over'); };
            content.ondragleave = (e) => content.classList.remove('drag-over');
            content.ondrop = (e) => { e.preventDefault(); content.classList.remove('drag-over'); if(dragSrc && dragSrc !== fullPath) moveEntry(dragSrc, fullPath+"/"+dragSrc.split('/').pop()); };

            node.appendChild(content);
            if(!isFile && expandedFolders.has(fullPath)) {
                const children = document.createElement('div');
                children.className = 'tree-children open';
                buildDom(item, children, fullPath);
                node.appendChild(children);
            }
            container.appendChild(node);
        });
    }
    buildDom(structure, tree);
}

function toggleFolder(p) { if(expandedFolders.has(p)) expandedFolders.delete(p); else expandedFolders.add(p); renderTree(); }
function openFile(p) {
    currentPath = p;
    if(!openedFiles.includes(p)) openedFiles.push(p);
    monaco.editor.setModelLanguage(editor.getModel(), getLang(p));
    editor.setValue(files[p].content);
    renderTree(); renderTabs();
}

// Menu Ops
const ctxMenu = document.getElementById('context-menu');
let ctxTarget = null, ctxIsFile = true;
function showCtx(e, p, f) {
    e.preventDefault(); ctxTarget = p; ctxIsFile = f;
    let x = e.pageX, y = e.pageY;
    if(x+160>window.innerWidth) x-=160; if(y+100>window.innerHeight) y-=100;
    ctxMenu.style.left = x+'px'; ctxMenu.style.top = y+'px';
    ctxMenu.style.display = 'block';
}
document.addEventListener('click', () => ctxMenu.style.display = 'none');
if(editor) editor.onMouseDown(() => ctxMenu.style.display = 'none');

function ctxDelete() {
    if(confirm("Delete?")) {
        if(ctxIsFile) { delete files[ctxTarget]; closeFile(ctxTarget); }
        else Object.keys(files).forEach(k => { if(k.startsWith(ctxTarget+'/')) { delete files[k]; closeFile(k); } });
        saveFiles(); renderTree();
    }
}
function ctxRename() {
    const n = prompt("Rename:", ctxTarget.split('/').pop());
    if(!n) return;
    const parent = ctxTarget.substring(0, ctxTarget.lastIndexOf('/'));
    const np = parent ? `${parent}/${n}` : n;
    moveEntry(ctxTarget, np);
}
function ctxMove() {
    const dest = prompt("Move to folder (empty for root):", "");
    if(dest === null) return;
    const d = dest.trim().replace(/\/$/, "");
    const fn = ctxTarget.split('/').pop();
    const np = d ? `${d}/${fn}` : fn;
    moveEntry(ctxTarget, np);
}
function moveEntry(oldP, newP) {
    if(files[oldP]) {
        if(files[newP]) { alert("Exists"); return; }
        files[newP] = files[oldP]; delete files[oldP];
        const idx = openedFiles.indexOf(oldP); if(idx!==-1) openedFiles[idx] = newP;
        if(currentPath === oldP) currentPath = newP;
    } else {
        Object.keys(files).forEach(k => {
            if(k.startsWith(oldP+'/')) {
                const s = k.substring(oldP.length);
                const d = newP + s;
                files[d] = files[k]; delete files[k];
                const idx = openedFiles.indexOf(k); if(idx!==-1) openedFiles[idx] = d;
                if(currentPath === k) currentPath = d;
            }
        });
        if(expandedFolders.has(oldP)) { expandedFolders.delete(oldP); expandedFolders.add(newP); }
    }
    saveFiles(); renderTree(); renderTabs();
}
function ctxRun() { if(ctxIsFile) { openFile(ctxTarget); runProject(); } }

function createNewFile() {
    let p = prompt("Filename:", ""); if(!p) return;
    if(!p.includes('.')) p += ".txt";
    if(files[p]) return;
    files[p] = { content: "", mode: getLang(p) };
    saveFiles(); renderTree(); updateFileCount(); openFile(p);
}
function createNewFolder() {
    const p = prompt("Folder:", "new_folder"); if(!p) return;
    files[`${p}/.keep`] = { content: "", mode: "plaintext" };
    expandedFolders.add(p); saveFiles(); renderTree(); updateFileCount();
}

function updateFileCount() { document.getElementById('file-count').innerText = Object.keys(files).length; }
function getLang(p) { return p.endsWith('.py')?'python':(p.endsWith('.js')?'javascript':(p.endsWith('.html')?'html':(p.endsWith('.css')?'css':'plaintext'))); }
function getIcon(p) { return p.endsWith('.py')?'🐍':(p.endsWith('.js')?'📜':(p.endsWith('.html')?'🌐':(p.endsWith('.css')?'🎨':'📄'))); }

// --- Runner ---
let pyWorker = null;
function initPyWorker() {
    document.getElementById('py-status-text').innerText = "Loading";
    try {
        pyWorker = new Worker('py-worker.js');
        pyWorker.onmessage = (e) => {
            const d = e.data;
            if(d.type==='ready') document.getElementById('py-status-text').innerText = "Ready";
            else if(d.type==='stdout') log(d.text);
            else if(d.type==='error') log(d.error, 'red');
            else if(d.type==='dom_op') handleDomOp(d);
        };
    } catch(e) { console.error(e); }
}
initPyWorker();

function handleDomOp(data) {
    const frame = isRightPreview ? document.getElementById('right-preview-frame') : document.getElementById('bottom-preview-frame');
    if(frame && frame.contentDocument) {
        const el = frame.contentDocument.getElementById(data.id);
        if(el) { if(data.op==='write') el.innerHTML=data.content; if(data.op==='append') el.innerHTML+=data.content; }
    }
}

async function runProject() {
    const btn = document.getElementById('runBtn'); btn.disabled = true;
    if(currentPath.endsWith('.py')) {
        switchPanel('terminal');
        setTimeout(() => {
            const d = {}; for(let f in files) d[f] = files[f].content;
            pyWorker.postMessage({ cmd: 'run', code: files[currentPath].content, files: d });
            btn.disabled = false;
        }, 100);
    } else {
        if(!isRightPreview) switchPanel('preview');
        let entry = files['index.html'] ? 'index.html' : (currentPath.endsWith('.html') ? currentPath : null);
        let html = entry ? bundleFiles(entry) : "No index.html";
        document.getElementById(isRightPreview ? 'right-preview-frame' : 'bottom-preview-frame').srcdoc = html;
        btn.disabled = false;
    }
}

function bundleFiles(p) {
    let h = files[p].content;
    h = h.replace(/<link\s+href=["']([^"']+)["'][^>]*>/g, (m,v) => files[v] ? `<style>${files[v].content}</style>` : m);
    h = h.replace(/<script\s+src=["']([^"']+)["'][^>]*><\/script>/g, (m,v) => files[v] ? `<script>${files[v].content}</script>` : m);
    return h;
}

// UI
const termLog = document.getElementById('term-log');
const shellIn = document.getElementById('shell-input');
shellIn.addEventListener('keydown', e => {
    if(e.key === 'Enter') { log(`$ ${shellIn.value}`, '#888'); shellIn.value = ""; }
});
function log(msg, color) {
    const d = document.createElement('div'); d.textContent = msg; if(color) d.style.color = color;
    termLog.appendChild(d); document.getElementById('output').scrollTop = 99999;
}
function clearOutput() { termLog.innerHTML = ""; }
function openPopup() {
    document.getElementById('popup-overlay').style.display = 'flex';
    if(files['index.html']) document.getElementById('popup-content').srcdoc = bundleFiles('index.html');
}

function switchPanel(mode) {
    document.getElementById('terminal-area').className = mode === 'terminal' ? 'show' : '';
    document.getElementById('bottom-preview-area').className = mode === 'preview' ? 'show' : '';
    document.getElementById('tab-term').className = mode === 'terminal' ? 'panel-tab active' : 'panel-tab';
    document.getElementById('tab-prev').className = mode === 'preview' ? 'panel-tab active' : 'panel-tab';
}

const rH = document.getElementById('resizer-h'), bP = document.getElementById('bottom-panel');
rH.addEventListener('mousedown', initH); rH.addEventListener('touchstart', initH, {passive:false});
function initH(e) { document.addEventListener('mousemove', doH); document.addEventListener('touchmove', doH, {passive:false}); document.addEventListener('mouseup', stopH); document.addEventListener('touchend', stopH); }
function doH(e) {
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    const h = window.innerHeight - cy - 24;
    if(h > 30) { bP.style.height = h + 'px'; editor.layout(); }
}
function stopH() { document.removeEventListener('mousemove', doH); document.removeEventListener('touchmove', doH); document.removeEventListener('mouseup', stopH); document.removeEventListener('touchend', stopH); }

const rV = document.getElementById('resizer-v'), rPane = document.getElementById('right-preview-pane');
rV.addEventListener('mousedown', initV);
function initV(e) { document.addEventListener('mousemove', doV); document.addEventListener('mouseup', stopV); }
function doV(e) { const w = window.innerWidth - e.clientX; if(w > 50) { rPane.style.width = w + 'px'; editor.layout(); } }
function stopV() { document.removeEventListener('mousemove', doV); document.removeEventListener('mouseup', stopV); }

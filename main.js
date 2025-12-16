// Service Worker登録
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(console.error);
}

// Ace Editorの設定
ace.require("ace/ext/language_tools");
const editor = ace.edit("editor");
editor.setTheme("ace/theme/monokai");     // 色分けテーマ
editor.session.setMode("ace/mode/python"); // Pythonモード
editor.setOptions({
    enableBasicAutocompletion: true, // 基本補完
    enableLiveAutocompletion: true,  // 入力中の自動補完
    showPrintMargin: false,
    fontSize: "14px"
});

const worker = new Worker('py-worker.js');
const statusDiv = document.getElementById('status');
const outputDiv = document.getElementById('output');

// 親ウィンドウとの連携データ
let contextData = { title: "", url: "", selection: "" };

// Python実行
function runCode() {
    outputDiv.innerText = "";
    statusDiv.textContent = "Running...";
    worker.postMessage({ cmd: 'run', code: editor.getValue(), isUserCode: true });
}

// 選択テキストの取得要求
function getSelectionData() {
    window.parent.postMessage({ type: 'request_selection' }, '*');
}

// 閉じる
function closePanel() {
    window.parent.postMessage({ type: 'close_pypanel' }, '*');
}

// 親からのメッセージ受信
window.addEventListener('message', (event) => {
    if (event.data.type === 'init_data') {
        contextData = event.data.payload;
        statusDiv.textContent = "Linked";
        // 隠しコマンドでPython側に変数をセット
        const setupCode = `
page_title = """${contextData.title}"""
page_url = "${contextData.url}"
selection = """${contextData.selection}"""
`;
        worker.postMessage({ cmd: 'run', code: setupCode, isUserCode: false });
    }
});

// Workerからのレスポンス処理
worker.onmessage = (e) => {
    const { type, text, results, error, isUserCode } = e.data;
    
    if (type === 'ready') statusDiv.textContent = "Ready (Offline OK)";
    
    if (isUserCode) {
        if (type === 'stdout') outputDiv.innerText += text + "\n";
        if (type === 'results') {
            if (results && results !== 'None') outputDiv.innerText += `=> ${results}\n`;
            statusDiv.textContent = "Finished";
        }
        if (type === 'error') {
            outputDiv.innerText += `Error: ${error}\n`;
            statusDiv.textContent = "Error";
        }
    }
};

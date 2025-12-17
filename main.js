// --- Service Worker (オフライン対応) ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(console.error);
}

// --- Ace Editor 設定 ---
ace.require("ace/ext/language_tools");
const editor = ace.edit("editor");
editor.setTheme("ace/theme/monokai");
// 初期モードはHTML(Web用)
editor.session.setMode("ace/mode/html"); 
editor.setOptions({
    enableBasicAutocompletion: true,
    enableLiveAutocompletion: true,
    enableSnippets: true,
    showPrintMargin: false,
    fontSize: "14px",
    tabSize: 4,
    useSoftTabs: true,
    wrap: true
});

// スマホでの入力体験向上
editor.renderer.setScrollMargin(10, 10);

// --- UI要素 ---
const statusSpan = document.getElementById('status');
const outputDiv = document.getElementById('output');
const previewFrame = document.getElementById('preview-frame');
const outputTitle = document.getElementById('output-title');
const runBtn = document.getElementById('runBtn');
const stopBtn = document.getElementById('stopBtn');
const langSelect = document.getElementById('langSelect');

let worker = null;
let isWorkerReady = false;

// ==========================================
// 全角スペース (日本語空白) 検知ロジック
// ==========================================
const Range = ace.require("ace/range").Range;
let zenkakuMarkers = [];

function highlightZenkakuSpace() {
    const session = editor.getSession();
    
    // 既存マーカー削除
    zenkakuMarkers.forEach(id => session.removeMarker(id));
    zenkakuMarkers = [];

    const doc = session.getDocument();
    const lines = doc.getAllLines();

    lines.forEach((line, row) => {
        for (let col = 0; col < line.length; col++) {
            if (line[col] === '\u3000') { // 全角スペース
                const range = new Range(row, col, row, col + 1);
                // cssクラス .zenkaku-space-marker を適用
                const markerId = session.addMarker(range, "zenkaku-space-marker", "text");
                zenkakuMarkers.push(markerId);
            }
        }
    });
}

// 入力変更のたびにチェック
editor.session.on('change', highlightZenkakuSpace);
// 初期実行
setTimeout(highlightZenkakuSpace, 500);


// ==========================================
// Worker制御 (Python)
// ==========================================
function initWorker() {
    if (worker) worker.terminate();

    worker = new Worker('py-worker.js');
    isWorkerReady = false;
    
    // Webモード以外でPythonが選ばれている場合のみステータス表示
    if(langSelect.value === 'python') statusSpan.textContent = "Pythonエンジン読込中...";

    worker.onmessage = (e) => {
        const { type, text, results, error } = e.data;

        if (type === 'ready') {
            isWorkerReady = true;
            if(langSelect.value === 'python') statusSpan.textContent = "準備完了 (Python)";
        } else if (type === 'stdout') {
            printOutput(text);
        } else if (type === 'results') {
            if (results && results !== 'None') {
                printOutput(`=> ${results}`);
            }
            executionFinished();
        } else if (type === 'error') {
            printOutput(`❌ エラー: ${error}`, true);
            executionFinished();
        }
    };
}

initWorker();


// ==========================================
// 実行処理
// ==========================================
function runCode() {
    const code = editor.getValue();
    const mode = langSelect.value;

    // Webモード以外はログ出力をクリア
    if (mode !== 'web') {
        outputDiv.innerText = ""; 
    }
    
    setRunningState(true);

    if (mode === 'web') {
        // --- Web (HTML+CSS+JS) 統合モード ---
        // outputDivを隠して iframe を表示
        outputDiv.style.display = 'none';
        previewFrame.style.display = 'block';
        outputTitle.innerText = "Webプレビュー";
        
        // iframeにコードを流し込む
        previewFrame.srcdoc = code;
        
        statusSpan.textContent = "プレビュー更新完了";
        setTimeout(() => setRunningState(false), 500);

    } else if (mode === 'python') {
        // --- Python ---
        showLogConsole();
        if (!isWorkerReady) {
            printOutput("⚠️ Pythonエンジンが準備できていません。少々お待ちください。", true);
            setRunningState(false);
            return;
        }
        worker.postMessage({ cmd: 'run', code: code });

    } else if (mode === 'javascript') {
        // --- JavaScript (Console) ---
        showLogConsole();
        try {
            const originalLog = console.log;
            console.log = (...args) => {
                printOutput(args.join(' '));
            };
            
            // 簡易実行
            new Function(code)();
            
            console.log = originalLog;
            printOutput("\n[JavaScript 実行完了]");
        } catch (e) {
            printOutput(`❌ JSエラー: ${e.message}`, true);
        }
        setRunningState(false);

    } else if (mode === 'typescript') {
        // --- TypeScript (Demo) ---
        showLogConsole();
        printOutput("ℹ️ TypeScript簡易実行: ブラウザ上でJSとして実行します（型チェックはスキップされます）。\n");
        try {
            const originalLog = console.log;
            console.log = (...args) => printOutput(args.join(' '));
            
            // TSシンタックスが含まれるとエラーになる可能性があるため案内を表示
            try {
                eval(code); 
            } catch(e) {
                if(e instanceof SyntaxError) {
                    printOutput("⚠️ 構文エラー: 型定義(: string等)を含めるとブラウザで直接実行できません。\n純粋なJS構文か、コンパイル後のコードを記述してください。", true);
                } else {
                    printOutput(`❌ エラー: ${e.message}`, true);
                }
            }
            
            console.log = originalLog;
        } catch (e) {
            printOutput(`❌ エラー: ${e.message}`, true);
        }
        setRunningState(false);

    } else {
        // --- その他 (Java, Go など) ---
        showLogConsole();
        printOutput(`ℹ️ '${mode}' は現在シンタックスハイライトのみ対応しています。\n実行機能は実装されていません。`);
        setRunningState(false);
    }
}

// ログ出力エリアを表示するヘルパー
function showLogConsole() {
    outputDiv.style.display = 'block';
    previewFrame.style.display = 'none';
    outputTitle.innerText = "実行ログ";
}

// ログ出力
function printOutput(text, isError = false) {
    if (isError) {
        outputDiv.innerHTML += `<span style="color:#ff5555;">${text}</span>\n`;
    } else {
        outputDiv.innerText += text + "\n";
    }
    outputDiv.scrollTop = outputDiv.scrollHeight;
}

function clearOutput() {
    outputDiv.innerText = "";
    if (previewFrame.contentWindow) {
        previewFrame.srcdoc = ""; // プレビューもクリア
    }
}

// --- ストップ処理 ---
function stopCode() {
    if (worker && langSelect.value === 'python') {
        worker.terminate();
        printOutput("\n[ユーザー停止]", true);
        initWorker();
    }
    setRunningState(false);
}

function setRunningState(isRunning) {
    if (isRunning) {
        runBtn.style.display = 'none';
        stopBtn.style.display = 'inline-flex';
        statusSpan.textContent = "実行中...";
        statusSpan.style.color = "#ffff00";
    } else {
        runBtn.style.display = 'inline-flex';
        stopBtn.style.display = 'none';
        statusSpan.textContent = "待機中";
        statusSpan.style.color = "#aaa";
        
        if(langSelect.value === 'python' && isWorkerReady) {
            statusSpan.textContent = "準備完了 (Python)";
            statusSpan.style.color = "#66d9ef";
        }
    }
}

function executionFinished() {
    setRunningState(false);
}

// --- 言語切り替え & デモコード ---
function changeLanguage() {
    const mode = langSelect.value;
    statusSpan.textContent = `${mode} モード`;
    
    // Webモードがデフォルトの見た目
    let aceMode = "ace/mode/html";
    let demoCode = "";

    switch(mode) {
        case 'web':
            aceMode = "ace/mode/html";
            // HTML, CSS, JS をまとめて書けるデモ
            demoCode = `<!DOCTYPE html>
<html lang="ja">
<head>
<style>
  /* CSSをここに記述 */
  body { font-family: sans-serif; background: #f0f0f0; padding: 20px; }
  h1 { color: #e91e63; }
  .box { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
</style>
</head>
<body>

  <div class="box">
    <h1>Web統合モード</h1>
    <p>ここにHTML, CSS, JSをまとめて書けます。</p>
    <button onclick="sayHello()">アラートを表示</button>
  </div>

<script>
  // JavaScriptをここに記述
  function sayHello() {
    alert("こんにちは！JSも動いています。");
  }
  
  // コンソール出力も確認できます
  console.log("Webモード開始");
</script>
</body>
</html>`;
            break;

        case 'python':
            aceMode = "ace/mode/python";
            demoCode = `# Pythonコード
import sys

print(f"Python Ver: {sys.version.split()[0]}")

def calc(n):
    return n * n

print(f"10の二乗は {calc(10)} です")

# 全角スペースのテスト（オレンジ色になります）
# ↓
　
`;
            if(isWorkerReady) statusSpan.textContent = "準備完了 (Python)";
            break;

        case 'typescript':
            aceMode = "ace/mode/typescript";
            demoCode = `// TypeScript デモ
// ※ブラウザ実行のため、型定義を除いたJS互換の記法のみ動作します

const greeting = "Hello TypeScript";
const year = 2025;

console.log(greeting + " " + year);

// 以下の関数は動作します
function add(a, b) {
    return a + b;
}
console.log("Add: " + add(10, 20));
`;
            break;

        case 'javascript':
            aceMode = "ace/mode/javascript";
            demoCode = `// JavaScript (Node.js風 コンソール出力)
console.log("JS実行モードです");
const arr = [1, 2, 3];
arr.forEach(n => console.log("Value:", n));
`;
            break;

        case 'java':
            aceMode = "ace/mode/java";
            demoCode = `// Java (シンタックスハイライトのみ)
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello World");
    }
}`;
            break;
            
        case 'golang':
            aceMode = "ace/mode/golang";
            demoCode = `// Go (シンタックスハイライトのみ)
package main
import "fmt"

func main() {
    fmt.Println("Hello, Go!")
}`;
            break;
    }

    editor.session.setMode(aceMode);
    editor.setValue(demoCode, -1);
    
    // マーカー再適用
    setTimeout(highlightZenkakuSpace, 100);
}

// 初期ロード時にWebモードのデモを表示
changeLanguage();

// Ctrl+Enterで実行
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runCode();
    }
});

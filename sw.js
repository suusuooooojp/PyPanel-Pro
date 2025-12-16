const CACHE_NAME = 'pypanel-v6'; // バージョンアップ
const URLS = [
    './',
    './index.html',
    './main.js',
    './py-worker.js',
    'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js',
    'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.asm.js',
    'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.asm.wasm',
    'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/python_stdlib.zip',
    'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs/loader.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

self.addEventListener('install', e => {
    self.skipWaiting();
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(URLS)));
});

self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(
        keys.map(k => k !== CACHE_NAME ? caches.delete(k) : null)
    )));
});

self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);
    // 外部CDNも含めてキャッシュする戦略
    if (url.hostname.includes('cdn') || url.hostname.includes('cdnjs')) {
        e.respondWith(caches.open(CACHE_NAME).then(c => 
            c.match(e.request).then(r => r || fetch(e.request).then(res => {
                c.put(e.request, res.clone());
                return res;
            }))
        ));
    } else {
        e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
    }
});

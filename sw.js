const CACHE_NAME = 'pypanel-ultra-v1';
const ASSETS = [
    './',
    './index.html',
    './main.js',
    './py-worker.js',
    'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js',
    'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.asm.js',
    'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.asm.wasm',
    'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/python_stdlib.zip',
    'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.2/ace.js',
    'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.2/ext-language_tools.js',
    'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.2/theme-vibrant_ink.js',
    'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.2/mode-python.js',
    'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.2/mode-javascript.js',
    'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.2/mode-html.js'
];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('fetch', (e) => {
    e.respondWith(caches.match(e.request).then(res => res || fetch(e.request)));
});

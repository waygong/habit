// sw.js — 極簡離線快取。改版時把 VERSION 加一,舊快取會自動清掉。
const VERSION = 'hl-6f31fe4f';
const ASSETS = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icon.png',
  'icons/icon-orange.png', 'icons/icon-green.png', 'icons/icon-blue.png',
  'icons/icon-purple.png', 'icons/icon-pink.png', 'icons/icon-slate.png',
  'js/main.js', 'js/habit.js', 'js/store.js', 'js/db.js', 'js/model.js',
  'js/ops.js', 'js/io.js', 'js/render.js', 'js/lite-extras.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 快取優先(離線就能用),背景抓新版存起來。
//   一定要指名 VERSION 這個快取 —— 用 caches.match() 不指名會把「所有」快取都翻一遍,
//   舊版快取只要還沒清掉就會先命中,更新後照樣拿到舊檔。
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(e.request);
    const net = fetch(e.request)
      .then((res) => { if (res && res.ok) cache.put(e.request, res.clone()); return res; })
      .catch(() => hit);
    return hit || net;
  })());
});

// sw.js — 極簡離線快取。改版時把 VERSION 加一,舊快取會自動清掉。
const VERSION = 'hl-059f4887';
const ASSETS = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icon.png',
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

// 快取優先(離線就能用),背景抓新版存起來,下次開就是新的。
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res && res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});

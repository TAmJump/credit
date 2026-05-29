/* CarePAY Service Worker
   静的サイト（GitHub Pages）向けの app-shell キャッシュ。
   - 同一オリジンの GET は stale-while-revalidate
   - HTML ナビゲーションはネット優先（更新を取りこぼさない）→ 失敗時キャッシュ
   - 外部CDN（Square SDK 等）はキャッシュ対象外（常にネット）
*/
const VERSION = 'carepay-v1';
const SHELL = [
  './',
  './index.html',
  './demo.html',
  './manifest.webmanifest',
  './assets/img/icon-192.png',
  './assets/img/icon-512.png',
  './assets/img/apple-touch-icon.png',
  './assets/img/favicon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 外部オリジン（Square CDN 等）は素通し
  if (url.origin !== self.location.origin) return;

  // HTML ナビゲーション → network first
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // その他の同一オリジン資産 → stale-while-revalidate
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

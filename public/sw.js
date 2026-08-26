const CACHE = 'efc-shell-v66';
const SHELL = ['/', '/index.html', '/i18n.js?v=66', '/app.js?v=66', '/styles.css?v=66', '/manifest.json', '/logo.svg', '/logo-animated.svg', '/asphalt-pro-logo-animated.svg?v=64', '/asphalt-pro-logo-es.svg?v=66', '/icon.svg', '/zukor-logo.svg', '/send.js?v=66', '/vendor/html2canvas.min.js?v=59'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // never cache API or uploads; always go to network
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/uploads')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request).then(r => r || caches.match('/')))
  );
});

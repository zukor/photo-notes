const CACHE = 'efc-shell-v82';
const SHELL = ['/', '/index.html', '/i18n.js?v=74', '/app.js?v=82', '/styles.css?v=82', '/manifest.json', '/logo.svg', '/logo-animated.svg', '/tensor-man-badge.png', '/tensor-man-badge@2x.png', '/tensor-man-hover.png', '/tensor-man-hover@2x.png', '/tensor-man-open.png', '/tensor-man-open@2x.png', '/photo-notes-ai-paving-pro-animated.svg?v=79', '/photo-notes-ai-concrete-pro-animated.svg?v=77', '/photo-notes-ai-hoa-maintenance-pro-animated.svg?v=81', '/icon.svg', '/zukor-logo.svg', '/send.js?v=74', '/vendor/html2canvas.min.js?v=59'];

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

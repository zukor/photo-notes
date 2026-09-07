const CACHE = 'efc-shell-v174';
const SHELL = ['/', '/index.html', '/i18n.js?v=174', '/app.js?v=146', '/styles.css?v=174', '/manifest.json?v=150', '/logo.svg', '/logo-animated.svg?v=83', '/tensor-man-badge.png', '/tensor-man-badge@2x.png', '/tensor-man-hover.png', '/tensor-man-hover@2x.png', '/tensor-man-open.png', '/tensor-man-open@2x.png', '/photo-notes-ai-basic-animated.svg?v=118', '/photo-notes-ai-pro-animated.svg?v=127', '/photo-notes-ai-pro-static.svg?v=127', '/photo-notes-ai-general-contractor-pro-animated.svg?v=127', '/photo-notes-ai-general-contractor-pro-static.svg?v=127', '/photo-notes-ai-paving-pro-animated.svg?v=118', '/photo-notes-ai-concrete-pro-animated.svg?v=78', '/photo-notes-ai-hoa-maintenance-pro-animated.svg?v=118', '/photo-notes-ai-road-issue-reporter-animated.svg?v=118', '/photo-notes-ai-roofer-pro-animated.svg?v=118', '/zukor-logo.svg', '/send.js?v=171', '/vendor/html2canvas.min.js?v=59'];
SHELL.push('/concrete-capture.js?v=174', '/issue-reporter.js?v=165', '/concrete-footprints.js?v=155', '/app.js?v=174', '/favicon-16.png?v=150', '/favicon-32.png?v=150', '/favicon-48.png?v=150', '/icon-180.png?v=150', '/icon-192.png?v=150', '/icon-512.png?v=150', '/icon-maskable-192.png?v=150', '/icon-maskable-512.png?v=150');

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

self.addEventListener('push',event=>{let url='/?issues=1';try{if(event.data.json().url==='/admin')url='/admin';}catch{}event.waitUntil(self.registration.showNotification('Photo Notes',{body:'There is an update in your issue reports.',icon:'/icon-192.png?v=150',tag:'photo-notes-issue-update',data:{url}}));});
self.addEventListener('notificationclick',event=>{event.notification.close();const url=event.notification.data?.url==='/admin'?'/admin':'/?issues=1';event.waitUntil(self.clients.openWindow(url));});

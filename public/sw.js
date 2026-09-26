const CACHE = 'efc-shell-v280';
const SHELL = ['/issue-presentation.js?v=280','/issue-review-guidance.js?v=280','/issue-retest-guidance.js?v=280','/account-menu.js?v=280','/share-photo-details.js?v=280','/word-preview.js?v=280','/word-preview-frame.js','/vendor/jszip.min.js','/vendor/docx-preview.min.js','/theme.js?v=280', '/theme.css?v=280', '/testing-hub.js?v=280','/testing-hub.css?v=280','/document-links.js?v=280', '/help.js?v=280', '/', '/index.html', '/i18n.js?v=280', '/app.js?v=280', '/styles.css?v=280', '/manifest.json?v=150', '/logo.svg', '/logo-animated.svg?v=83', '/photo-notes-ai-basic-animated.svg?v=118', '/photo-notes-ai-pro-animated.svg?v=127', '/photo-notes-ai-pro-static.svg?v=127', '/photo-notes-ai-general-contractor-pro-animated.svg?v=127', '/photo-notes-ai-general-contractor-pro-static.svg?v=127', '/photo-notes-ai-paving-pro-animated.svg?v=118', '/photo-notes-ai-concrete-pro-animated.svg?v=78', '/photo-notes-ai-hoa-maintenance-pro-animated.svg?v=118', '/photo-notes-ai-road-issue-reporter-animated.svg?v=118', '/photo-notes-ai-roofer-pro-animated.svg?v=118', '/zukor-logo.svg', '/zukor-logo.png', '/send.js?v=280', '/vendor/html2canvas.min.js?v=59'];
SHELL.push('/concrete-purpose-menu.js?v=280', '/ramo-intake.js?v=280', '/capture-queue.js?v=280', '/install-help.js?v=280', '/install-page.js?v=280', '/install-help.css?v=280', '/install.html', '/issue-markup.js?v=280', '/concrete-capture.js?v=175', '/issue-reporter.js?v=280', '/concrete-footprints.js?v=280', '/app.js?v=280', '/favicon-16.png?v=150', '/favicon-32.png?v=150', '/favicon-48.png?v=150', '/icon-180.png?v=150', '/icon-192.png?v=150', '/icon-512.png?v=150', '/icon-maskable-192.png?v=150', '/icon-maskable-512.png?v=150');

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll([...new Set(SHELL)])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // never cache API or uploads; always go to network
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/uploads') || url.pathname.startsWith('/shared-document')) return;
  if(e.request.method!=='GET'||url.origin!==self.location.origin)return;
  e.respondWith(fetch(e.request).catch(async()=>{
    const cached=await caches.match(e.request);
    if(cached)return cached;
    if(e.request.mode==='navigate')return await caches.match('/')||Response.error();
    return Response.error();
  }));
});

self.addEventListener('push',event=>{let url='/?issues=1';try{if(event.data.json().url==='/admin')url='/admin';}catch{}event.waitUntil(self.registration.showNotification('Photo Notes',{body:'There is an update in your issue reports.',icon:'/icon-192.png?v=150',tag:'photo-notes-issue-update',data:{url}}));});
self.addEventListener('notificationclick',event=>{event.notification.close();const url=event.notification.data?.url==='/admin'?'/admin':'/?issues=1';event.waitUntil(self.clients.openWindow(url));});

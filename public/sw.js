const CACHE = 'efc-shell-v334-bulk-metadata-1-qr2';
const SHELL = ['/bulk-metadata.js?v=1','/location-intelligence.js?v=1','/photo-comments.js?v=1','/photo-comments.css?v=1','/capture-templates.js?v=1','/related-photos.js?v=1','/help.css?v=332','/help-catalog.js?v=334','/issue-routing.js?v=314','/first-use.js?v=296','/shortcuts.js?v=298','/branding.js?v=290','/photonotes-ai-logo-static.svg?v=290','/photonotes-ai-logo-animated.svg?v=290','/issue-presentation.js?v=314','/issue-review-guidance.js?v=286','/issue-retest-guidance.js?v=313','/account-menu.js?v=286','/share-photo-details.js?v=286','/word-preview.js?v=286','/word-preview-frame.js','/vendor/jszip.min.js','/vendor/docx-preview.min.js','/theme.js?v=286', '/theme.css?v=286', '/testing-hub.js?v=320','/testing-hub.css?v=286','/document-links.js?v=298', '/help.js?v=332', '/', '/index.html', '/i18n.js?v=314', '/app.js?v=334-qr2', '/styles.css?v=332', '/manifest.json?v=150', '/logo.svg', '/logo-animated.svg?v=83', '/photo-notes-ai-basic-animated.svg?v=118', '/photo-notes-ai-pro-animated.svg?v=127', '/photo-notes-ai-pro-static.svg?v=127', '/photo-notes-ai-general-contractor-pro-animated.svg?v=127', '/photo-notes-ai-general-contractor-pro-static.svg?v=127', '/photo-notes-ai-paving-pro-animated.svg?v=118', '/photo-notes-ai-concrete-pro-animated.svg?v=78', '/photo-notes-ai-hoa-maintenance-pro-animated.svg?v=118', '/photo-notes-ai-road-issue-reporter-animated.svg?v=118', '/photo-notes-ai-roofer-pro-animated.svg?v=118', '/zukor-logo.svg', '/zukor-logo.png', '/send.js?v=310', '/vendor/html2canvas.min.js?v=59'];
SHELL.push('/concrete-purpose-menu.js?v=286', '/ramo-intake.js?v=286', '/capture-queue.js?v=310', '/install-help.js?v=332', '/install-page.js?v=286', '/install-help.css?v=332', '/install.html', '/issue-markup.js?v=286', '/concrete-capture.js?v=175', '/issue-reporter.js?v=314', '/concrete-footprints.js?v=332', '/app.js?v=334-qr2', '/favicon-16.png?v=150', '/favicon-32.png?v=150', '/favicon-48.png?v=150', '/icon-180.png?v=150', '/icon-192.png?v=150', '/icon-512.png?v=150', '/icon-maskable-192.png?v=150', '/icon-maskable-512.png?v=150');

// Optional physical-context QR shell resources.
SHELL.push('/qr-codes.js?v=2','/qr-codes.css?v=2');

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(DUPLICATE_CACHE).then(c => c.addAll([...new Set(SHELL)])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== DUPLICATE_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
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

// Context reuse shares the shell with a separate cache generation.
const DUPLICATE_CACHE = CACHE + '-duplicate-1';
SHELL.push('/duplicate-context.js?v=1');

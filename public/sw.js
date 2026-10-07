const CACHE = 'efc-shell-v366-aligned-floating-controls';
const SHELL = ['/photo-follow-ups.js?v=360','/photo-follow-ups.css?v=357','/saved-views.js?v=357','/saved-views.css?v=357','/match-camera.js?v=1','/visual-analysis.js?v=357','/bulk-metadata.js?v=357','/location-intelligence.js?v=1','/photo-comments.js?v=1','/photo-comments.css?v=357','/capture-templates.js?v=359','/related-photos.js?v=357','/help.css?v=366','/help-catalog.js?v=366','/issue-routing.js?v=350','/first-use.js?v=297','/shortcuts.js?v=348','/branding.js?v=290','/photonotes-ai-logo-static.svg?v=290','/photonotes-ai-logo-animated.svg?v=290','/issue-presentation.js?v=314','/issue-review-guidance.js?v=286','/issue-retest-guidance.js?v=313','/account-menu.js?v=286','/share-photo-details.js?v=286','/word-preview.js?v=286','/word-preview-frame.js','/vendor/jszip.min.js','/vendor/docx-preview.min.js','/theme.js?v=364', '/theme.css?v=365', '/testing-hub.js?v=350','/testing-hub.css?v=286','/document-links.js?v=298', '/help.js?v=350', '/', '/index.html', '/i18n.js?v=359', '/app.js?v=366', '/styles.css?v=364', '/manifest.json?v=150', '/logo.svg', '/logo-animated.svg?v=83', '/photo-notes-ai-basic-animated.svg?v=118', '/photo-notes-ai-pro-animated.svg?v=127', '/photo-notes-ai-pro-static.svg?v=127', '/photo-notes-ai-general-contractor-pro-animated.svg?v=127', '/photo-notes-ai-general-contractor-pro-static.svg?v=127', '/photo-notes-ai-paving-pro-animated.svg?v=118', '/photo-notes-ai-concrete-pro-animated.svg?v=78', '/photo-notes-ai-hoa-maintenance-pro-animated.svg?v=118', '/photo-notes-ai-road-issue-reporter-animated.svg?v=118', '/photo-notes-ai-roofer-pro-animated.svg?v=118', '/zukor-logo.svg', '/zukor-logo.png', '/zukor-logo-dark.svg?v=364', '/send.js?v=310', '/vendor/html2canvas.min.js?v=59'];
SHELL.push('/concrete-purpose-menu.js?v=286', '/ramo-intake.js?v=286', '/capture-queue.js?v=310', '/install-help.js?v=350', '/install-page.js?v=286', '/install-help.css?v=332', '/install.html', '/issue-markup.js?v=286', '/concrete-capture.js?v=175', '/issue-reporter.js?v=356', '/concrete-footprints.js?v=332', '/app.js?v=366', '/favicon-16.png?v=150', '/favicon-32.png?v=150', '/favicon-48.png?v=150', '/icon-180.png?v=150', '/icon-192.png?v=150', '/icon-512.png?v=150', '/icon-maskable-192.png?v=150', '/icon-maskable-512.png?v=150');

// Optional physical-context QR shell resources.
SHELL.push('/qr-codes.js?v=2','/qr-codes.css?v=357');

SHELL.push('/export-presets.js?v=1');
SHELL.push('/photo-requests.js?v=1','/photo-requests.css?v=357');

SHELL.push('/custom-fields.js?v=1','/custom-fields.css?v=357');
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(EXPORT_PRESET_CACHE).then(c => c.addAll([...new Set(SHELL)].map(asset => new Request(new URL(/^\/(app|help-catalog)\.js/.test(asset) ? asset + '&export-presets=1' : asset, self.location.origin), { cache: /^\/(app|help-catalog)\.js/.test(asset) ? 'reload' : 'default' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== EXPORT_PRESET_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
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

self.addEventListener('push',event=>{let data={};try{data=event.data.json();}catch{}const follow=data.url==='/?followups=1',url=follow?'/?followups=1':data.url==='/admin'?'/admin':'/?issues=1';event.waitUntil(self.registration.showNotification(follow?'Photo Follow-Up':'Photo Notes',{body:follow?String(data.body||'A follow-up photograph is due.'):'There is an update in your issue reports.',icon:'/icon-192.png?v=150',tag:follow?String(data.tag||'photo-follow-up'):'photo-notes-issue-update',data:{url}}));});
self.addEventListener('notificationclick',event=>{event.notification.close();const target=event.notification.data?.url,url=target==='/?followups=1'?target:target==='/admin'?'/admin':'/?issues=1';event.waitUntil(self.clients.openWindow(url));});

// Context reuse shares the shell with a separate cache generation.
const DUPLICATE_CACHE = CACHE + '-duplicate-2';
SHELL.push('/duplicate-context.js?v=1');

const EXPORT_PRESET_CACHE = DUPLICATE_CACHE + '-export-presets-1';

SHELL.push('/maintenance-terminology.js?v=1');

SHELL.push('/property-incidents.js?v=1','/property-areas.js?v=357');

const CACHE = 'efc-shell-v502-sendsimple';
const SHELL = ['/customer-feedback.js?v=480','/customer-feedback.css?v=1','/speech-document.js?v=3','/speech-session-frame.html','/photonotes-ai-logo-dark.svg?v=1','/scanner-availability.js?v=3','/proposal-exhibit.js?v=2','/photo-follow-ups.js?v=398','/photo-follow-ups.css?v=357','/photo-requests.js?v=396','/saved-views.js?v=357','/saved-views.css?v=357','/match-camera.js?v=1','/visual-analysis.js?v=359','/bulk-metadata.js?v=357','/location-intelligence.js?v=2','/photo-comments.js?v=1','/photo-comments.css?v=357','/capture-templates.js?v=471','/related-photos.js?v=358','/help.css?v=376','/help-catalog.js?v=502','/issue-routing.js?v=350','/first-use.js?v=300','/shortcuts.js?v=350','/branding.js?v=290','/photonotes-ai-logo-static.svg?v=290','/photonotes-ai-logo-animated.svg?v=290','/issue-presentation.js?v=314','/issue-review-guidance.js?v=286','/issue-retest-guidance.js?v=442','/account-menu.js?v=286','/share-photo-details.js?v=286','/word-preview.js?v=286','/word-preview-frame.js','/vendor/jszip.min.js','/vendor/docx-preview.min.js','/theme.js?v=390', '/theme.css?v=389', '/testing-hub.js?v=442','/testing-hub.css?v=286','/document-links.js?v=298', '/help.js?v=470', '/', '/index.html', '/i18n.js?v=478', '/app.js?v=502', '/styles.css?v=478', '/manifest.json?v=371', '/logo.svg', '/logo-animated.svg?v=83', '/photo-notes-ai-basic-animated.svg?v=118', '/photo-notes-ai-pro-animated.svg?v=127', '/photo-notes-ai-pro-static.svg?v=127', '/photo-notes-ai-general-contractor-pro-animated.svg?v=127', '/photo-notes-ai-general-contractor-pro-static.svg?v=127', '/photo-notes-ai-paving-pro-animated.svg?v=118', '/photo-notes-ai-concrete-pro-animated.svg?v=78', '/photo-notes-ai-hoa-maintenance-pro-animated.svg?v=118', '/photo-notes-ai-road-issue-reporter-animated.svg?v=118', '/photo-notes-ai-roofer-pro-animated.svg?v=118', '/zukor-logo.svg', '/zukor-logo.png', '/zukor-logo-dark.svg?v=364', '/send.js?v=443', '/vendor/html2canvas.min.js?v=59'];
SHELL.push('/vendor/aruco/cv.js?v=2.0.0','/vendor/aruco/aruco.js?v=2.0.0','/precision-measure-engine.js?v=1','/precision-measure.js?v=4','/measuring-card.html','/measuring-card.js?v=1','/paving-quality-rules.js?v=1','/paving-quality-ui.js?v=4','/concrete-quality-rules.js?v=1','/concrete-quality-ui.js?v=3','/photo-location.js?v=2','/geo-measure.js?v=3','/concrete-estimate-rules.js?v=5','/concrete-estimate-ui.js?v=5','/repair-outline.js?v=1','/satellite-measure-ui.js?v=1','/paving-takeoff-ui.js?v=1');
SHELL.push('/concrete-purpose-menu.js?v=470', '/ramo-intake.js?v=286', '/capture-queue.js?v=444', '/install-help.js?v=442', '/install-page.js?v=371', '/install-help.css?v=332', '/install.html', '/issue-markup.js?v=286', '/concrete-capture.js?v=175', '/issue-reporter.js?v=484', '/concrete-footprints.js?v=402', '/favicon-16.png?v=150', '/favicon-32.png?v=150', '/favicon-48.png?v=150', '/icon-180.png?v=150', '/icon-192.png?v=150', '/icon-512.png?v=150', '/icon-maskable-192.png?v=150', '/icon-maskable-512.png?v=150');
SHELL.push('/live-transcription.js?v=6','/pcm-capture-worklet.js?v=1');

// Optional physical-context QR shell resources.
SHELL.push('/qr-codes.js?v=3','/qr-codes.css?v=357');

SHELL.push('/export-presets.js?v=4');
SHELL.push('/photo-requests.css?v=357');

SHELL.push('/custom-fields.js?v=442','/custom-fields.css?v=357');
// Files only some screens or editions use. Installation does not fail when one of them cannot be
// fetched; each is cached on its own, and again whenever the app fetches it.
const OPTIONAL_SHELL = /^\/(vendor\/|measuring-card|speech-session-frame|word-preview-frame|install-page\.js|proposal-exhibit\.js|ramo-intake\.js|zukor-logo-dark\.jpg|favicon-|icon-|photo-notes-ai-(?!basic|pro-)|admin)/;
const shellRequest = asset => new Request(new URL(/^\/(app|help-catalog)\.js/.test(asset) ? asset + '&export-presets=1' : asset, self.location.origin), { cache: /^\/(app|help-catalog)\.js/.test(asset) ? 'reload' : 'default' });
self.addEventListener('install', (e) => {
  const assets = [...new Set(SHELL)], core = assets.filter(asset => !OPTIONAL_SHELL.test(asset)), optional = assets.filter(asset => OPTIONAL_SHELL.test(asset));
  e.waitUntil(caches.open(EXPORT_PRESET_CACHE).then(async c => {
    await c.addAll(core.map(shellRequest));
    if (typeof c.add === 'function') await Promise.all(optional.map(asset => c.add(shellRequest(asset)).catch(() => {})));
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== EXPORT_PRESET_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // never cache API or uploads; always go to network
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/uploads') || url.pathname.startsWith('/thumbs') || url.pathname.startsWith('/shared-document')) return;
  if(e.request.method!=='GET'||url.origin!==self.location.origin)return;
  // A versioned file never changes at its address, so the saved copy is used without waiting for the network.
  if(url.searchParams.has('v')){e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(response=>{if(response.ok&&response.type==='basic'){const copy=response.clone();void caches.open(EXPORT_PRESET_CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});}return response;})).catch(()=>Response.error()));return;}
  // Pages get about three seconds of network before the saved app opens, so a weak signal does not leave a blank screen.
  const fallback=async()=>{const cached=await caches.match(e.request);if(cached)return cached;if(e.request.mode==='navigate')return await caches.match('/')||Response.error();return Response.error();};
  if(e.request.mode!=='navigate'){e.respondWith(fetch(e.request).catch(fallback));return;}
  e.respondWith(new Promise(resolve=>{
    let settled=false;const finish=response=>{if(settled)return;settled=true;resolve(response);};
    const timer=typeof setTimeout==='function'?setTimeout(()=>fallback().then(cached=>{if(cached&&cached.type!=='error')finish(cached);}),3000):null;
    fetch(e.request).then(response=>{if(timer)clearTimeout(timer);finish(response);},()=>{if(timer)clearTimeout(timer);fallback().then(finish);});
  }));
});

self.addEventListener('push',event=>{let data={};try{data=event.data.json();}catch{}const follow=data.url==='/?followups=1',url=follow?'/?followups=1':data.url==='/admin'?'/admin':'/?issues=1';event.waitUntil(self.registration.showNotification(follow?'Photo Follow-Up':'Photo Notes',{body:follow?String(data.body||'A follow-up photograph is due.'):'There is an update in your issue reports.',icon:'/icon-192.png?v=150',tag:follow?String(data.tag||'photo-follow-up'):'photo-notes-issue-update',data:{url}}));});
self.addEventListener('notificationclick',event=>{event.notification.close();const target=event.notification.data?.url,url=target==='/?followups=1'?target:target==='/admin'?'/admin':'/?issues=1';event.waitUntil(self.clients.openWindow(url));});

// Context reuse shares the shell with a separate cache generation.
const DUPLICATE_CACHE = CACHE + '-duplicate-2';
SHELL.push('/duplicate-context.js?v=2');

const EXPORT_PRESET_CACHE = DUPLICATE_CACHE + '-export-presets-1';

SHELL.push('/maintenance-terminology.js?v=2');

SHELL.push('/property-incidents.js?v=3','/floor-plans.js?v=1','/property-areas.js?v=357');

SHELL.push('/annotation-templates.js?v=1');

SHELL.push('/user-usage.js?v=1');

SHELL.push('/zukor-logo-dark.jpg?v=1');

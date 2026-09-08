const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {indexedDB,IDBFactory}=require('fake-indexeddb');
const queue=require('../public/capture-queue');
const install=require('../public/install-help');
const source=fs.readFileSync('public/app.js','utf8');

test('pending photos survive reopening and keep account, version, bytes, and retry identity',async()=>{
 global.indexedDB=new IDBFactory();
 const one=await queue.accountKey('One@example.invalid'),two=await queue.accountKey('two@example.invalid');
 const photo=new Blob(['original photo'],{type:'image/jpeg'});
 const saved=await queue.create({photo,photoName:'test.jpg',note:'Retain notes'},false,one,'basic');
 const [restored]=await queue.all();assert.equal(restored.requestId,saved.requestId);assert.equal(await restored.payload.photo.text(),'original photo');
 assert.equal(restored.payload.note,'Retain notes');assert(queue.eligible(restored,one,'basic'));assert(!queue.eligible(restored,two,'basic'));assert(!queue.eligible(restored,one,'pro'));
 assert.equal(queue.headers(restored)['X-Photo-Notes-Account'],one);
 assert.equal(queue.headers(restored)['X-Photo-Notes-Capture-Id'],saved.requestId);
 await queue.remove(restored.id);assert.equal((await queue.all()).length,0);
});
test('legacy captures without owner metadata are retained but never eligible to upload',async()=>{
 global.indexedDB=new IDBFactory();await queue.all();
 await new Promise((resolve,reject)=>{const r=global.indexedDB.open('photo-notes-offline',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('captures','readwrite');tx.objectStore('captures').add({payload:{note:'legacy'}});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
 const rows=await queue.all();assert.equal(rows.length,1);assert(!queue.eligible(rows[0],await queue.accountKey('one@example.invalid'),'basic'));
});
test('storage unavailable cannot report a local save',async()=>{global.indexedDB=undefined;await assert.rejects(queue.create({note:'retain'},false,'a'.repeat(64),'basic'),/storage unavailable/);});
test('queue saves resolve on commit and reject an aborted transaction',async()=>{
 for(const abort of [false,true]){let tx,closed=false;global.indexedDB={open(){const r={};queueMicrotask(()=>{r.result={transaction(){tx={objectStore:()=>({add:()=>({result:42})})};return tx;},close(){closed=true;}};r.onsuccess();});return r;}};
 let settled=false;const pending=queue.create({},false,'a'.repeat(64),'basic').then(row=>{settled=true;assert.equal(row.id,42);},()=>{settled=true;assert(abort);});await new Promise(setImmediate);assert(!settled);abort?tx.onabort():tx.oncomplete();await pending;assert(closed);
 }
});
function saveFixture(fail){let release,calls=0;const photo={name:'photo.jpg'},state={photoFile:photo,_note:'draft',location:null};const c={state,document:{getElementById:()=>({value:'draft'})},stopCaptureDictation(){},toast(){},isHoaClient:()=>false,isConcreteClient:()=>false,isPavingClient:()=>false,confirmPhotoQuality:async()=>true,enqueueUpload:async()=>{calls++;await new Promise(r=>release=r);if(fail)throw Error('full');},freshDims:()=>({}),renderCapture(){},captureLocationGeneration:0};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('let captureSavePending='),source.indexOf('// ================= HOA Maintenance Pro')),c);return {c,state,photo,release:()=>release(),calls:()=>calls};}
test('ordinary Save retains the draft until durable commit and suppresses double taps',async()=>{
 const f=saveFixture(false);const pending=f.c.saveCapture();await new Promise(setImmediate);assert.equal(f.state.photoFile,f.photo);assert.equal(await f.c.saveCapture(),false);assert.equal(f.calls(),1);f.release();assert.equal(await pending,true);assert.equal(f.state.photoFile,null);
});
test('ordinary Save keeps the photo and notes when storage fails',async()=>{const f=saveFixture(true),pending=f.c.saveCapture();await new Promise(setImmediate);f.release();assert.equal(await pending,false);assert.equal(f.state.photoFile,f.photo);assert.equal(f.state._note,'draft');});
test('installation instructions select each platform including iPad desktop identity',()=>{
 for(const [ua,platform,touches,expected] of [['iPhone','iPhone',1,'iphone'],['Macintosh','MacIntel',5,'iphone'],['Android','Linux',1,'android'],['Macintosh','MacIntel',0,'mac'],['Windows','Win32',0,'windows']])assert.equal(install.platform(ua,platform,touches),expected);
 for(const platform of ['iphone','android','mac','windows']){const html=install.markup(platform);assert(html.includes('selected'));assert(!html.includes('undefined'));}
 assert(install.guides.iphone.steps.join(' ').includes('Open as Web App'));assert(install.guides.mac.steps.join(' ').includes('Add to Dock'));
});
test('service worker never substitutes HTML for a missing script or an API response',async()=>{
 const handlers={},shell={html:true};let response;
 const c={URL,Response,self:{location:{origin:'https://photonotesapp.com'},addEventListener:(name,handler)=>handlers[name]=handler},fetch:async()=>{throw Error('offline');},caches:{match:async key=>key==='/'?shell:undefined}};vm.createContext(c);vm.runInContext(fs.readFileSync('public/sw.js','utf8'),c);
 const request=(path,mode='cors')=>({request:{url:'https://photonotesapp.com'+path,method:'GET',mode},respondWith:r=>response=r});
 handlers.fetch(request('/missing.js'));assert.equal((await response).type,'error');
 handlers.fetch(request('/screen','navigate'));assert.equal(await response,shell);
 response=null;handlers.fetch(request('/api/me'));assert.equal(response,null);
});
test('all offline shell assets exist and scripts are loaded before the main app',()=>{
 const sw=fs.readFileSync('public/sw.js','utf8'),index=fs.readFileSync('public/index.html','utf8');const paths=[...sw.matchAll(/'(\/[^']+)'/g)].map(x=>x[1].split('?')[0]);
 for(const path of paths.filter(p=>/\.(js|css|html|png|svg|json)$/.test(p)&&!p.startsWith('/vendor/')))assert(fs.existsSync('public'+path),path);
 assert(index.indexOf('/capture-queue.js')<index.indexOf('/app.js'));assert(index.indexOf('/install-help.js')<index.indexOf('/app.js'));
});

test('offline installation caches each URL only once',async()=>{
 const handlers={};let installed,urls;const c={self:{addEventListener:(name,handler)=>handlers[name]=handler,skipWaiting(){}},caches:{open:async()=>({addAll:async values=>{urls=values;}})}};vm.createContext(c);vm.runInContext(fs.readFileSync('public/sw.js','utf8'),c);handlers.install({waitUntil:value=>installed=value});await installed;assert.equal(urls.length,new Set(urls).size);assert(urls.includes('/install.html'));
});

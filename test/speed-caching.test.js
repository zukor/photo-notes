'use strict';
// Speed and reliability behind the scenes: compression, cache headers, slim Library lists,
// background address fixes and receipt clean-up. None of these change what users see.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const slice=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));

async function listen(){
 const uploads=fs.mkdtempSync(path.join(os.tmpdir(),'pn-speed-'));process.env.UPLOAD_DIR=uploads;
 await require('sharp')({create:{width:40,height:30,channels:3,background:'#888'}}).jpeg().toFile(path.join(uploads,'photo.jpg'));
 const {app}=require('../server');const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 return {base:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(r=>server.close(r))};
}

test('versioned files are kept for a year, photos stay private, and nothing else is marked permanent',async()=>{
 const s=await listen();
 try{
  const header=async(url,enc='identity')=>{const r=await fetch(s.base+url,{headers:{'Accept-Encoding':enc}});await r.arrayBuffer();return {status:r.status,cache:r.headers.get('cache-control'),encoding:r.headers.get('content-encoding')};};
  assert.equal((await header('/app.js?v=1')).cache,'public, max-age=31536000, immutable');
  assert.notEqual((await header('/app.js')).cache,'public, max-age=31536000, immutable');
  assert.notEqual((await header('/no-such-file.js?v=1')).cache,'public, max-age=31536000, immutable','the page fallback for a missing file is never kept');
  // Photos need sign-in or a signed link (see upload privacy tests); a signed link is used here.
  const q=require('../upload-access').signedUrl(process.env.SESSION_SECRET||'dev-secret-change-me','/uploads/photo.jpg',Date.now()+3600000).split('?')[1];
  assert.equal((await header('/uploads/photo.jpg')).status,401,'photos are private');
  assert.equal((await header('/uploads/photo.jpg?'+q+'&v=3')).cache,'private, max-age=86400');
  assert.equal((await header('/uploads/photo.jpg?'+q)).cache,'private, no-cache');
  assert.equal((await header('/thumbs/photo.jpg?'+q+'&v=3')).cache,'private, max-age=86400');
  assert.equal((await header('/thumbs/photo.jpg?'+q)).cache,'private, no-cache');
  assert.equal((await header('/app.js?v=1','gzip')).encoding,'gzip','scripts are compressed');
  assert.equal((await header('/uploads/photo.jpg?'+q,'gzip')).encoding,null,'photos are sent as they are');
 }finally{await s.close();}
});

test('Library lists leave out stored AI responses and the duplicate hash, and keep every other field',()=>{
 const c={};vm.createContext(c);vm.runInContext(slice('const LIBRARY_LIST_OMIT','app.get(\'/api/captures\''),c);
 const rows=c.libraryRows([{id:1,note:'n',dim_ai:{raw:'x'},defect_ai:{raw:'y'},perceptual_hash:'abc',address:null,overlays:[1]}]);
 assert.deepEqual(rows,[{id:1,note:'n',address:null,overlays:[1]}]);
});

test('address fixes for many photos return at once and continue in spaced batches',async()=>{
 const updates=[],geocoded=[],events=[];let handler;
 const rows=Array.from({length:12},(_,i)=>({id:i+1,latitude:1,longitude:2,address:i%2?'Old':'Same'}));
 const c={app:{post:(p,a,h)=>{handler=h;}},requireAuth:()=>{},console,setTimeout:(fn)=>setImmediate(fn),
  pool:{query:async(sql,args)=>{if(/^UPDATE/.test(sql)){updates.push(args);return {rowCount:1};}return {rows:args[1]?rows.filter(r=>args[1].includes(r.id)):rows};}},
  reverseGeocode:async()=>{geocoded.push(Date.now());return 'Same';},logEvent:(u,a,d)=>events.push(d)};
 vm.createContext(c);vm.runInContext(slice('const REGEOCODE_INLINE_MAX','// ---- edit a single capture'),c);
 const call=body=>new Promise(resolve=>handler({user:{id:7},body},{json:resolve,status(){return this;}}));
 const small=await call({ids:[1,2]});
 assert.deepEqual({...small},{ok:true,updated:1,unchanged:1,unresolved:0,total:2},'a few photos are answered with counts');
 const large=await call({});
 assert.equal(large.queued,true);assert.equal(large.total,12);
 const again=await call({});assert.equal(again.running,true,'a second request does not start a second run');
 for(let i=0;i<50&&events.length<2;i++)await new Promise(r=>setImmediate(r));
 assert.deepEqual({...events[1]},{updated:6,unchanged:6,unresolved:0,total:12});
});

test('upload receipts older than 90 days are removed at start and daily',async()=>{
 const {pruneCaptureReceipts,RECEIPT_RETENTION_DAYS}=require('../capture-receipts');let sql,args;
 await pruneCaptureReceipts({query:async(s,a)=>{sql=s;args=a;return {rowCount:3};}});
 assert.equal(RECEIPT_RETENTION_DAYS,90);assert.match(sql,/DELETE FROM capture_upload_receipts WHERE created_at < now\(\) - make_interval\(days => \$1\)/);assert.deepEqual(args,[90]);
 assert.match(source,/pruneReceipts\(\);setInterval\(pruneReceipts,24\*60\*60\*1000\)/);
});

test('address lookups and server checks give up instead of hanging',()=>{
 const geocode=slice('async function reverseGeocode(','// ---- captures');
 assert.equal((geocode.match(/await fetch\(/g)||[]).length,(geocode.match(/AbortSignal\.timeout\(GEOCODE_TIMEOUT_MS\)/g)||[]).length,'every lookup has a time limit');
 for(const route of ["app.get('/api/me'","app.get('/api/admin/health'"])assert.match(slice(route,'\n});'),/res\.status\(503\)/,route);
});

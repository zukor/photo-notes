'use strict';
// Pending photo storage: details and previews are read without photo bytes, and photos saved by
// earlier releases (bytes inside the row) still upload and move to the photo store without loss.
const test=require('node:test'),assert=require('node:assert/strict');
const {IDBFactory}=require('fake-indexeddb');
const queue=require('../public/capture-queue');

function openVersion(version,upgrade){return new Promise((resolve,reject)=>{const r=global.indexedDB.open('photo-notes-offline',version);r.onupgradeneeded=()=>upgrade&&upgrade(r.result);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function put(db,store,value){return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite'),req=tx.objectStore(store).add(value);tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(tx.error);});}
function readAll(store){return openVersion(undefined).then(db=>new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),req=tx.objectStore(store).getAll();tx.oncomplete=()=>{db.close();resolve(req.result);};tx.onerror=()=>reject(tx.error);}));}

test('new pending photos keep their bytes apart from the list of pending PhotoNotes',async()=>{
 global.indexedDB=new IDBFactory();
 const account=await queue.accountKey('store@example.invalid');
 const saved=await queue.create({photo:new Blob(['full photo bytes'],{type:'image/jpeg'}),note:'Gate latch'},true,account,'pro');
 const [row]=await queue.list();
 assert.equal(row.id,saved.id);assert.equal(row.hasPhoto,true);assert.equal(row.payload.photo,null);assert.equal(row.payload.note,'Gate latch');
 assert.equal('photoBytes' in row,false,'the list never carries photo bytes');
 assert.equal(await (await queue.photo(saved.id)).text(),'full photo bytes');
 assert.equal((await readAll('photos')).length,1);
 const [restored]=await queue.all();assert.equal(await restored.payload.photo.text(),'full photo bytes','earlier callers still receive the photo');
 await queue.remove(saved.id);
 assert.equal((await queue.list()).length,0);assert.equal((await readAll('photos')).length,0,'removing a PhotoNote removes its photo');
});

test('a note without a photo stores no photo record',async()=>{
 global.indexedDB=new IDBFactory();
 const account=await queue.accountKey('store@example.invalid');
 const saved=await queue.create({note:'Text only'},false,account,'basic');
 assert.equal(await queue.photo(saved.id),null);assert.equal((await readAll('photos')).length,0);
 assert.equal((await queue.list())[0].hasPhoto,undefined);
});

test('photos queued by the earlier release upload unchanged and move to the photo store one at a time',async()=>{
 global.indexedDB=new IDBFactory();
 const account=await queue.accountKey('legacy@example.invalid');
 // Version 2 layout: the photo bytes live inside the queued row.
 const db=await openVersion(2,database=>{database.createObjectStore('drafts',{keyPath:'key'});database.createObjectStore('captures',{keyPath:'id',autoIncrement:true});});
 const bytes=new TextEncoder().encode('original queued photo').buffer;
 const id=await put(db,'captures',{account,edition:'pro',requestId:crypto.randomUUID(),payload:{note:'Queued before update',photo:null},hadCoords:false,createdAt:Date.now(),photoBytes:bytes,photoType:'image/jpeg'});
 db.close();
 const [listed]=await queue.list();
 assert.equal(listed.id,id);assert.equal(listed.hasPhoto,true);assert.equal(listed.legacyPhoto,true);assert.equal('photoBytes' in listed,false);
 assert(queue.eligible(listed,account,'pro'));
 assert.equal(await (await queue.photo(id)).text(),'original queued photo','an unmoved photo still uploads');
 assert.equal(await queue.migrate(id),true);
 const [stored]=await readAll('captures');assert.equal('photoBytes' in stored,false);assert.equal(stored.hasPhoto,true);
 assert.equal(await (await queue.photo(id)).text(),'original queued photo','the moved photo is identical');
 assert.equal((await queue.list())[0].legacyPhoto,undefined);
 assert.equal(await queue.migrate(id),false,'moving twice changes nothing');
 assert.equal(await (await queue.photo(id)).text(),'original queued photo');
 await queue.remove(id);assert.equal((await readAll('photos')).length,0);
});

test('a removed PhotoNote is not brought back by a late move or preview',async()=>{
 global.indexedDB=new IDBFactory();
 const account=await queue.accountKey('race@example.invalid');
 const saved=await queue.create({photo:new Blob(['x'],{type:'image/jpeg'})},false,account,'pro');
 await queue.remove(saved.id);
 assert.equal(await queue.migrate(saved.id),false);
 assert.equal(await queue.addThumbnail(saved.id,new Blob(['x'])),false);
 assert.equal((await queue.list()).length,0);assert.equal((await readAll('photos')).length,0);
});

test('previews are saved with the PhotoNote and read without the photo',async()=>{
 global.indexedDB=new IDBFactory();
 const previous={createImageBitmap:global.createImageBitmap,OffscreenCanvas:global.OffscreenCanvas};
 global.createImageBitmap=async()=>({width:4000,height:3000,close(){}});
 let size;global.OffscreenCanvas=class{constructor(w,h){size=[w,h];}getContext(){return {drawImage(){}};}async convertToBlob(){return new Blob(['small preview'],{type:'image/jpeg'});}};
 try{
  const account=await queue.accountKey('preview@example.invalid');
  const saved=await queue.create({photo:new Blob(['large photo'],{type:'image/jpeg'})},false,account,'pro');
  for(let i=0;i<20&&!(await queue.thumbnail(saved.id));i++)await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(size,[640,480],'previews are at most 640 pixels on the long side');
  assert.equal(await (await queue.thumbnail(saved.id)).text(),'small preview');
  const [row]=await queue.list();assert.equal(await queue.thumbnailBlob(row).text(),'small preview');
  assert.equal(await (await queue.photo(saved.id)).text(),'large photo','the preview never replaces the photo');
 }finally{global.createImageBitmap=previous.createImageBitmap;global.OffscreenCanvas=previous.OffscreenCanvas;}
});

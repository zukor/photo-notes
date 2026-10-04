'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {IDBFactory}=require('fake-indexeddb');
const {editionIds,user,capture}=require('./support/factories.cjs');
const {currentEdition}=require('../editions');
const queue=require('../public/capture-queue');
test('all ten edition factory identities map to the actual account edition',()=>{for(const edition of editionIds)assert.equal(currentEdition(user(edition)),edition,edition);});
test('offline restart preserves image bytes and specialty metadata; account/edition isolation and retry identity survive',async()=>{
 global.indexedDB=new IDBFactory();
 const account=await queue.accountKey(' OWNER@example.invalid '),other=await queue.accountKey('other@example.invalid');
 assert.equal(account,await queue.accountKey('owner@example.invalid'));
 for(const edition of editionIds.filter(e=>e!=='issue')){
  const payload=capture({photo:new Blob([Buffer.from([255,216,255,217])],{type:'image/jpeg'}),job_id:12,property_area_id:9,capture_template_id:'saved-template',follow_up_id:17});
  const saved=await queue.create(payload,true,account,edition);
  const restarted=(await queue.all()).find(r=>r.id===saved.id);
  assert.equal(restarted.requestId,saved.requestId,edition+' stable retry identity');
  assert.deepEqual(Buffer.from(await restarted.payload.photo.arrayBuffer()),Buffer.from([255,216,255,217]));
  const {photo,...metadata}=restarted.payload;const {photo:original,...expected}=payload;assert.deepEqual(metadata,expected,edition+' specialty metadata');
  assert(queue.eligible(restarted,account,edition));assert(!queue.eligible(restarted,other,edition));
  assert(!queue.eligible(restarted,account,edition==='pro'?'basic':'pro'));
  assert.equal(queue.headers(restarted)['X-Photo-Notes-Capture-Id'],saved.requestId);
  await queue.remove(saved.id);assert.equal((await queue.all()).length,0);
 }
 await assert.rejects(queue.create({},false,'invalid','pro'),/Sign in/);
 await assert.rejects(queue.create({},false,account,'unknown'),/Sign in/);
 for(const code of [400,401,403,409,413,422])assert(queue.permanent(code));
 for(const code of [429,500,502,503,504])assert(!queue.permanent(code));
});

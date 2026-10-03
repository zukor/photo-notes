const test=require('node:test'),assert=require('node:assert/strict');
const f=require('../photo-follow-ups');
test('calendar recurrence preserves month end anchor and leap year',()=>{
 assert.equal(f.recurrenceDate('2026-01-31',{unit:'month',interval:1},1),'2026-02-28');
 assert.equal(f.recurrenceDate('2026-01-31',{unit:'month',interval:1},2),'2026-03-31');
 assert.equal(f.recurrenceDate('2024-02-29',{unit:'year',interval:1},1),'2025-02-28');
 assert.equal(f.recurrenceDate('2024-02-29',{unit:'year',interval:1},4),'2028-02-29');
 assert.equal(f.recurrenceDate('2026-10-03',{unit:'month',interval:3},3),'2027-07-03');
 assert.equal(f.recurrenceDate('2026-10-02',{unit:'week',interval:1},2),'2026-10-16');
});
test('local date semantics across midnight and daylight saving',()=>{
 assert.equal(f.today('America/Chicago',new Date('2026-10-04T01:00:00Z')),'2026-10-03');
 assert.equal(f.today('Pacific/Auckland',new Date('2026-10-04T01:00:00Z')),'2026-10-04');
 for(const instant of ['2026-03-08T07:59:00Z','2026-03-08T08:01:00Z'])assert.equal(f.today('America/Chicago',new Date(instant)),'2026-03-08');
});
test('rejects malformed dates and recurrence',()=>{
 const valid={title:'Crack',due_date:'2026-12-15',timezone:'America/Chicago'};
 assert.equal(f.validate(valid).recurrence,null);
 for(const extra of [{due_date:'2026-02-30'},{timezone:'server-local'},{recurrence:{unit:'month',interval:0}},{recurrence:{unit:'month',interval:1.5}},{reminder_days:2}])assert.throws(()=>f.validate({...valid,...extra}));
});
test('edition rollout excludes Basic and reporters',()=>{
 for(const key of f.EDITIONS)assert(f.eligible({plan:'pro',pro_type:key==='pro'?'general':key}));
 for(const key of ['general','issue','roads'])assert(!f.eligible({plan:'free',pro_type:key}));
});
test('offline queue preserves occurrence identity and serializes it after reopening',async()=>{
 const {IDBFactory}=require('fake-indexeddb'),queue=require('../public/capture-queue'),vm=require('node:vm'),fs=require('node:fs');global.indexedDB=new IDBFactory();
 const account=await queue.accountKey('monitor@example.invalid'),saved=await queue.create({photo:new Blob(['new evidence']),photoName:'follow.jpg',note:'new observation',follow_up_occurrence_id:'123',latitude:41,longitude:-91},true,account,'concrete');
 const restored=(await queue.all()).find(r=>r.id===saved.id);assert.equal(restored.payload.follow_up_occurrence_id,'123');assert.equal(await restored.payload.photo.text(),'new evidence');assert.equal(restored.requestId,saved.requestId);
 const source=fs.readFileSync('public/app.js','utf8'),serializer=source.match(/function payloadFormData\(p\)\{[^\n]+\}/)[0],sandbox={FormData};vm.runInNewContext(serializer,sandbox);const fd=sandbox.payloadFormData(restored.payload);assert.equal(fd.get('follow_up_occurrence_id'),'123');assert.equal(fd.get('latitude'),'41');assert.equal(fd.get('longitude'),'-91');assert(queue.eligible(restored,account,'concrete'));assert(!queue.eligible(restored,account,'pro'));await queue.remove(saved.id);
});

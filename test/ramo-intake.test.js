const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('crypto');
const fs=require('fs/promises');
const os=require('os');
const path=require('path');
const {normalize,snapshot,deliver,allowed}=require('../ramo-intake');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const png=Buffer.from('89504e470d0a1a0a00000000','hex');
const base=()=>({requestId:crypto.randomUUID(),title:'Wall change',description:'Raise wall',photos:[{captureId:1,caption:'Current wall'}]});
test('one group validates limits, note association and nonempty description',()=>{
 const b=base();assert.deepEqual(normalize(b),b);
 for(const patch of [{photos:[]},{photos:Array.from({length:21},(_,i)=>({captureId:i+1}))},{photos:[{captureId:1},{captureId:1}]},{title:' '},{description:'',photos:[{captureId:1,caption:' '}]},{requestId:'bad'},{photos:[{captureId:2,caption:'a'.repeat(20001)}]}])assert.throws(()=>normalize({...b,...patch}));
});
test('immutable source uses original, rejects missing originals and fingerprint mismatch',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pn-ramo-'));
 try{
 await fs.writeFile(path.join(dir,'original.png'),png);await fs.writeFile(path.join(dir,'edited.png'),Buffer.from('edited'));
 const row={id:1,photo_original_path:'/uploads/original.png',photo_path:'/uploads/edited.png',original_sha256:digest(png)};
 const saved=await snapshot(row,dir);assert.deepEqual(saved.bytes,png);assert.equal(saved.attachment.mimeType,'image/png');
 await assert.rejects(snapshot({...row,original_sha256:'wrong'},dir),/original_photo_changed/);
 await assert.rejects(snapshot({...row,photo_original_path:'/uploads/missing.png'},dir),/original_photo_unavailable/);
 await assert.rejects(snapshot({...row,photo_original_path:'/uploads/../secret'},dir),/original_photo_unavailable/);
 await fs.writeFile(path.join(dir,'original.png'),Buffer.from('changed'));assert.deepEqual(saved.bytes,png);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
function fixture(){const submissionId=crypto.randomUUID(),intakeId=crypto.randomUUID(),attachments=[1,2].map(()=>({id:crypto.randomUUID(),sha256:digest(png),sizeBytes:png.length,mimeType:'image/png'}));return {manifest:{submissionId,attachments},intakeId};}
test('partial upload retries only missing photos and completes one submission',async()=>{
 const {manifest,intakeId}=fixture(),stored=new Set(),calls=[];let interrupted=true;
 const request=async(url,method,body)=>{
 calls.push(url);
 if(url==='/submissions')return {intakeId,submissionId:manifest.submissionId,missingAttachmentIds:manifest.attachments.filter(a=>!stored.has(a.id)).map(a=>a.id)};
 if(url.endsWith('/complete'))return {intakeId,submissionId:manifest.submissionId,status:'received',receivedAt:new Date().toISOString(),attachmentCount:2};
 const id=url.split('/').at(-1);if(stored.size===1&&interrupted){interrupted=false;throw Error('timeout');}stored.add(id);assert.deepEqual(body,png);return {attachmentId:id,stored:true};
 };
 await assert.rejects(deliver(manifest,async()=>png,request),/timeout/);
 const receipt=await deliver(manifest,async()=>png,request);assert.equal(receipt.attachmentCount,2);
 assert.equal(calls.filter(s=>s.endsWith(manifest.attachments[0].id)).length,1);
});
test('incomplete, mismatched and fabricated receipts never mean received',async()=>{
 const {manifest,intakeId}=fixture();
 for(const patch of [{status:'uploading'},{attachmentCount:1},{submissionId:crypto.randomUUID()},{receivedAt:null}]){
 await assert.rejects(deliver(manifest,async()=>png,async url=>url==='/submissions'?{intakeId,submissionId:manifest.submissionId,missingAttachmentIds:[]}:{intakeId,submissionId:manifest.submissionId,status:'received',receivedAt:new Date().toISOString(),attachmentCount:2,...patch}),/invalid_ramo_receipt/);
 }
 await assert.rejects(deliver(manifest,async()=>Buffer.from('bad'),async()=>({intakeId,submissionId:manifest.submissionId,missingAttachmentIds:[manifest.attachments[0].id]})),/saved_photo_integrity_error/);
});
test('ordinary Concrete users cannot submit to Ramo by default',()=>assert.equal(allowed({id:999999,role:'user'}),false));

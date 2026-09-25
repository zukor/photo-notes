const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const {isSuperAdmin} = require('./super-admin');
const BASE = 'https://ramo-optimizer.up.railway.app/api/project-delivery/photo-notes-intake';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fail(code, status=422) { const e=new Error(code); e.status=status; throw e; }
function text(value,max,required=false) { if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail('invalid_fields');return value; }
function allowed(user) { return isSuperAdmin(user)||String(process.env.RAMO_INTAKE_ALLOWED_USER_IDS||'').split(',').map(s=>s.trim()).includes(String(user.id)); }
function normalize(input) {
  if(!UUID.test(input.requestId||''))fail('invalid_submission_id');
  if(typeof input.title!=='string'||!input.title.trim())fail('title_required');
  const title=text(input.title,240,true),description=text(input.description||'',50000);
  if(!Array.isArray(input.photos)||input.photos.length<1||input.photos.length>20)fail('select_1_to_20_photos');
  const photos=input.photos.map(p=>{if(!Number.isSafeInteger(p.captureId)||p.captureId<1)fail('invalid_photo');return {captureId:p.captureId,caption:text(p.caption||'',20000)};});
  if(new Set(photos.map(p=>p.captureId)).size!==photos.length)fail('duplicate_photo');
  if(!description.trim()&&!photos.some(p=>p.caption.trim()))fail('description_required');
  return {requestId:input.requestId.toLowerCase(),title,description,photos};
}
function mime(bytes) {
  if(bytes.subarray(0,3).equals(Buffer.from([255,216,255])))return ['image/jpeg','.jpg'];
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return ['image/png','.png'];
  if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return ['image/webp','.webp'];
  if(bytes.toString('ascii',4,8)==='ftyp'){
    const brand=bytes.toString('ascii',8,12);
    if(['heic','heix','hevc','hevx'].includes(brand))return ['image/heic','.heic'];
    if(['mif1','msf1'].includes(brand))return ['image/heif','.heif'];
  }
  fail('unsupported_original_photo');
}
async function snapshot(capture,uploadDir) {
  const source=capture.photo_original_path||capture.photo_path;
  if(!source||!source.startsWith('/uploads/')||path.basename(source)!==source.slice('/uploads/'.length))fail('original_photo_unavailable');
  const file=path.join(uploadDir,path.basename(source));
  let bytes;
  try {const stat=await fs.stat(file);if(stat.size>20*1024*1024)fail('photo_exceeds_20_mib',413);bytes=await fs.readFile(file);}catch(e){if(e.status)throw e;fail('original_photo_unavailable');}
  if(!bytes.length||bytes.length>20*1024*1024)fail('photo_exceeds_20_mib',413);
  const sha256=hash(bytes);
  if(capture.original_sha256&&capture.original_sha256!==sha256)fail('original_photo_changed');
  const [mimeType,ext]=mime(bytes);
  return {bytes,attachment:{id:crypto.randomUUID(),filename:`photo-${capture.id}${ext}`,mimeType,sizeBytes:bytes.length,sha256}};
}
function view(row) {return {id:row.id,title:row.manifest.title,description:row.manifest.description,status:row.status,createdAt:row.created_at,receivedAt:row.receipt?.receivedAt||null,attachmentCount:row.manifest.attachments.length,error:row.last_error||null};}
async function deliver(manifest,files,request) {
  const state=await request('/submissions','POST',manifest);
  if(!UUID.test(state.intakeId||'')||state.submissionId!==manifest.submissionId||!Array.isArray(state.missingAttachmentIds))fail('invalid_ramo_response',502);
  for(const id of state.missingAttachmentIds){
    const attachment=manifest.attachments.find(a=>a.id===id);
    if(!attachment)fail('invalid_ramo_response',502);
    const bytes=await files(id);
    if(!bytes||bytes.length!==attachment.sizeBytes||hash(bytes)!==attachment.sha256)fail('saved_photo_integrity_error');
    const result=await request(`/submissions/${state.intakeId}/files/${id}`,'PUT',bytes,attachment.mimeType);
    if(result.stored!==true||result.attachmentId!==id)fail('invalid_ramo_response',502);
  }
  const receipt=await request(`/submissions/${state.intakeId}/complete`,'POST',{});
  if(receipt.status!=='received'||receipt.intakeId!==state.intakeId||receipt.submissionId!==manifest.submissionId||receipt.attachmentCount!==manifest.attachments.length||!Number.isFinite(Date.parse(receipt.receivedAt)))fail('invalid_ramo_receipt',502);
  return receipt;
}
function registerRamoIntake(app,{pool,requireAuth,requireConcrete,uploadDir}) {
  const access=(req,res,next)=>allowed(req.user)?next():res.status(403).json({error:'ramo_access_required'});
  const safeOrigin=(req,res,next)=>{const origin=req.get('origin');if(origin){try{if(new URL(origin).host!==req.get('host'))return res.status(403).json({error:'invalid_origin'});}catch{return res.status(403).json({error:'invalid_origin'});}}next();};
  const guards=[requireAuth,requireConcrete,access];
  const route=(method,url,handler)=>app[method](url,...guards,...(method==='post'?[safeOrigin]:[]),async(req,res)=>{try{await handler(req,res);}catch(e){res.status(e.status||500).json({error:e.status?e.message:'submission_unavailable'});}});
  async function captures(userId,ids) {
    const result=await pool.query(`SELECT c.*,e.original_sha256,e.original_name,e.captured_at FROM captures c LEFT JOIN capture_evidence e ON e.capture_id=c.id AND e.user_id=c.user_id WHERE c.user_id=$1 AND c.id=ANY($2::int[])`,[userId,ids]);
    if(result.rows.length!==ids.length)fail('photo_not_found',404);
    return ids.map(id=>result.rows.find(r=>r.id===id));
  }
  route('get','/api/ramo-intake',async(req,res)=>{
    const rows=(await pool.query('SELECT id,manifest,status,receipt,last_error,created_at FROM ramo_intake_submissions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[req.user.id])).rows;
    res.json({configured:!!process.env.RAMO_INTAKE_TOKEN,submissions:rows.map(view)});
  });
  route('post','/api/ramo-intake/preview',async(req,res)=>{
    const ids=req.body.captureIds;
    if(!Array.isArray(ids)||!ids.length||ids.length>20||ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length)fail('select_1_to_20_photos');
    const rows=await captures(req.user.id,ids);
    res.json({photos:rows.map(c=>({captureId:c.id,photoPath:c.photo_original_path||c.photo_path,caption:[c.photo_title,c.note,...(Array.isArray(c.overlays)?c.overlays.filter(o=>o.text).map(o=>`Annotation: ${o.text}`):[])].filter(Boolean).join('\n'),capturedAt:c.captured_at||c.created_at,location:c.address||''}))});
  });
  route('post','/api/ramo-intake/submissions',async(req,res)=>{
    if(!process.env.RAMO_INTAKE_TOKEN)fail('ramo_not_configured',503);
    const input=normalize(req.body),requestHash=hash(JSON.stringify(input));
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)',[req.user.id]);
      const previous=(await client.query('SELECT * FROM ramo_intake_submissions WHERE user_id=$1 AND request_id=$2',[req.user.id,input.requestId])).rows[0];
      if(previous){if(previous.request_hash!==requestHash)fail('submission_changed',409);await client.query('COMMIT');res.json(view(previous));return;}
      const rows=await captures(req.user.id,input.photos.map(p=>p.captureId)),attachments=[],saved=[];let total=0;
      for(let i=0;i<rows.length;i++){
        const {bytes,attachment}=await snapshot(rows[i],uploadDir);total+=bytes.length;if(total>100*1024*1024)fail('submission_exceeds_100_mib',413);
        attachment.caption=input.photos[i].caption;
        const captured=rows[i].captured_at||rows[i].created_at;if(captured)attachment.capturedAt=new Date(captured).toISOString();
        if(rows[i].address)attachment.location=rows[i].address;
        attachments.push(attachment);saved.push(bytes);
      }
      const id=crypto.randomUUID(),manifest={schemaVersion:'1.0',submissionId:id,sourceReference:`photo-notes:${id}`,title:input.title,description:input.description,createdAt:new Date().toISOString(),...(req.user.name?{author:req.user.name}:{}),attachments};
      const row=(await client.query(`INSERT INTO ramo_intake_submissions(id,user_id,request_id,request_hash,manifest,status) VALUES($1,$2,$3,$4,$5,'sending') RETURNING *`,[id,req.user.id,input.requestId,requestHash,manifest])).rows[0];
      for(let i=0;i<attachments.length;i++)await client.query('INSERT INTO ramo_intake_files(submission_id,attachment_id,bytes) VALUES($1,$2,$3)',[id,attachments[i].id,saved[i]]);
      await client.query('COMMIT');res.status(201).json(view(row));
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    void tick();
  });
  route('post','/api/ramo-intake/submissions/:id/retry',async(req,res)=>{
    if(!UUID.test(req.params.id))fail('invalid_submission_id');
    if(!process.env.RAMO_INTAKE_TOKEN)fail('ramo_not_configured',503);
    const result=await pool.query(`UPDATE ramo_intake_submissions SET status=CASE WHEN status='received' THEN status ELSE 'sending' END,last_error=NULL WHERE id=$1 AND user_id=$2 RETURNING *`,[req.params.id,req.user.id]);
    if(!result.rows.length)fail('submission_not_found',404);res.json(view(result.rows[0]));void tick();
  });
  let busy=false;
  async function tick(){
    if(busy||!process.env.RAMO_INTAKE_TOKEN)return;busy=true;let client,locked=false;
    try{
      client=await pool.connect();locked=(await client.query("SELECT pg_try_advisory_lock(194782301) AS locked")).rows[0].locked;if(!locked)return;
      const rows=(await client.query("SELECT * FROM ramo_intake_submissions WHERE status='sending' ORDER BY created_at LIMIT 3")).rows;
      for(const row of rows){
        try{
          const receipt=await deliver(row.manifest,async id=>(await client.query('SELECT bytes FROM ramo_intake_files WHERE submission_id=$1 AND attachment_id=$2',[row.id,id])).rows[0]?.bytes,async(url,method,body,mimeType)=>{
            const r=await fetch(BASE+url,{method,redirect:'error',headers:{Authorization:`Bearer ${process.env.RAMO_INTAKE_TOKEN}`,'Content-Type':mimeType||'application/json'},body:Buffer.isBuffer(body)?body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
            if(!r.ok)fail(`ramo_http_${r.status}`,502);return r.json();
          });
          await client.query("UPDATE ramo_intake_submissions SET status='received',receipt=$2,last_error=NULL WHERE id=$1",[row.id,receipt]);
        }catch(e){await client.query("UPDATE ramo_intake_submissions SET status='failed',last_error=$2 WHERE id=$1",[row.id,e.status?e.message:'connection_interrupted']);}
      }
    }catch{ /* Database/startup failures leave durable submissions available for the next tick. */ }
    finally{if(client){if(locked)await client.query('SELECT pg_advisory_unlock(194782301)').catch(()=>{});client.release();}busy=false;}
  }
  return {start(){void tick();const timer=setInterval(()=>void tick(),10000);timer.unref();return timer;},tick};
}
module.exports={registerRamoIntake,normalize,mime,snapshot,deliver,allowed};

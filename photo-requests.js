'use strict';
const path=require('node:path');
const {currentEdition}=require('./editions');
const {externalPhotoUpload,privatePhotoToken,clean,inspectPhotos,saveExternalPhoto,removeUploads}=require('./external-photo-submission');
const EDITIONS=['pro','property','hoa','paving','concrete','contractor','roofer'];
function eligible(user){return !!user&&EDITIONS.includes(currentEdition(user));}
function validateRequest(body){
 const title=clean(body.title,200),instructions=clean(body.instructions),views=Array.isArray(body.views)?body.views.map(v=>clean(v,100)):[];
 const days=body.days===undefined?14:Number(body.days);
 if(!title||!instructions||!views.length||views.length>8||views.some(v=>!v)||new Set(views.map(v=>v.toLowerCase())).size!==views.length)throw new Error('Enter a title, instructions, and 1 to 8 distinct requested views.');
 if(!Number.isInteger(days)||days<1||days>30)throw new Error('Choose 1 to 30 days.');
 return {title,instructions,views,days,recipient_name:clean(body.recipient_name,200),allow_partial:body.allow_partial===true};
}
function validateSubmission(request,received,indices){
 const supplied=new Set(received.map(p=>Number(p.view_index)));
 if(!indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=request.views.length||supplied.has(i))||new Set(indices).size!==indices.length)throw new Error('Select a photo for a missing requested view.');
 if(!request.allow_partial&&supplied.size+indices.length!==request.views.length)throw new Error('Supply every requested view before submitting.');
 return supplied.size+indices.length===request.views.length?'completed':'partially_submitted';
}
function registerPhotoRequests(app,{pool,requireAuth,uploadDir,hoaHistory,hoaNotifyCompany}){
 const gate=(req,res,next)=>eligible(req.user)?next():res.status(403).json({error:'Photo Requests requires an eligible Pro edition.'});
 const upload=externalPhotoUpload(uploadDir);
 const history=(db,id,action,detail={})=>db.query('INSERT INTO photo_request_history(request_id,action,detail) VALUES($1,$2,$3)',[id,action,JSON.stringify(detail)]);
 async function expire(db){
  await db.query(`WITH expired AS (UPDATE photo_requests SET status='expired' WHERE status IN ('open','partially_submitted') AND expires_at<=now() RETURNING id) INSERT INTO photo_request_history(request_id,action) SELECT id,'expired' FROM expired`);
 }
 function privacy(req,res,next){res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'});next();}
 async function publicRequest(token,db=pool,lock=false){
  if(!/^[A-Za-z0-9_-]{32}$/.test(token))return null;
  return (await db.query(`SELECT r.* FROM photo_requests r JOIN users u ON u.id=r.user_id AND u.active=true WHERE r.token=$1 ${lock?'FOR UPDATE OF r':''}`,[token])).rows[0];
 }
 app.get('/api/photo-requests',requireAuth,gate,async(req,res)=>{try{
  await expire(pool);
  const requests=(await pool.query(`SELECT r.*,(SELECT count(*)::int FROM photo_request_photos p WHERE p.request_id=r.id) received_count FROM photo_requests r WHERE r.user_id=$1 ORDER BY r.created_at DESC LIMIT 200`,[req.user.id])).rows;
  res.json(requests.map(r=>({...r,url:`${req.protocol}://${req.get('host')}/photo-request/${r.token}`})));
 }catch(e){res.status(500).json({error:'Requests could not be loaded.'});}});
 app.post('/api/photo-requests',requireAuth,gate,async(req,res)=>{
  let db;
  try{
   let data;try{data=validateRequest(req.body||{});}catch(e){return res.status(400).json({error:e.message});}
   db=await pool.connect();await db.query('BEGIN');
   const association={};
   for(const key of ['related_capture_id','job_id','item_id']){
    const value=req.body[key];if(value===undefined||value===null||value==='')continue;
    const id=Number(value);if(!Number.isInteger(id)||id<1)throw new Error('Invalid related record.');
    let result;
    if(key==='related_capture_id')result=await db.query('SELECT job_id,area_tags FROM captures WHERE id=$1 AND user_id=$2 FOR SHARE',[id,req.user.id]);
    if(key==='job_id')result=await db.query('SELECT id FROM jobs WHERE id=$1 AND user_id=$2 FOR SHARE',[id,req.user.id]);
    if(key==='item_id'){
     if(!['hoa','property'].includes(currentEdition(req.user)))throw new Error('A maintenance record requires HOA or Property Manager Pro.');
     result=await db.query(`SELECT i.id FROM hoa_maintenance_items i JOIN hoa_company_members m ON m.company_id=i.company_id WHERE i.id=$1 AND m.user_id=$2 FOR SHARE OF i`,[id,req.user.id]);
    }
    if(!result.rowCount)throw new Error('Related record is unavailable.');association[key]=id;
    if(key==='related_capture_id')association.inheritedJob=result.rows[0].job_id;
   }
   const company=(await db.query('SELECT c.name FROM hoa_management_companies c JOIN hoa_company_members m ON m.company_id=c.id WHERE m.user_id=$1 ORDER BY c.id LIMIT 1',[req.user.id])).rows[0];
   const sender=clean(req.user.name,200)+(company?' / '+clean(company.name,200):'');
   const token=privatePhotoToken(),expires=new Date(Date.now()+data.days*86400000);
   const row=(await db.query(`INSERT INTO photo_requests(user_id,token,edition,title,recipient_name,sender_name,instructions,views,allow_partial,related_capture_id,job_id,item_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[req.user.id,token,currentEdition(req.user),data.title,data.recipient_name,sender,data.instructions,JSON.stringify(data.views),data.allow_partial,association.related_capture_id||null,association.job_id||association.inheritedJob||null,association.item_id||null,expires])).rows[0];
   await history(db,row.id,'created');await history(db,row.id,'link_created');await db.query('COMMIT');
   res.json({...row,url:`${req.protocol}://${req.get('host')}/photo-request/${token}`});
  }catch(e){if(db)await db.query('ROLLBACK');res.status(400).json({error:'Request could not be created. Check the related record.'});}finally{if(db)db.release();}
 });
 app.get('/api/photo-requests/:id',requireAuth,gate,async(req,res)=>{try{
  await expire(pool);const request=(await pool.query('SELECT * FROM photo_requests WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id])).rows[0];
  if(!request)return res.status(404).json({error:'Request not found.'});
  const photos=(await pool.query(`SELECT p.*,c.photo_path,c.photo_title,e.original_sha256,e.original_bytes FROM photo_request_photos p LEFT JOIN captures c ON c.id=p.capture_id LEFT JOIN capture_evidence e ON e.capture_id=c.id WHERE p.request_id=$1 ORDER BY p.view_index`,[request.id])).rows;
  const events=(await pool.query('SELECT action,detail,created_at FROM photo_request_history WHERE request_id=$1 ORDER BY id',[request.id])).rows;
  res.json({request,photos,history:events});
 }catch(e){res.status(500).json({error:'Request could not be loaded.'});}});
 app.post('/api/photo-requests/:id/cancel',requireAuth,gate,async(req,res)=>{try{
  const r=await pool.query(`WITH cancelled AS (UPDATE photo_requests SET status='cancelled' WHERE id=$1 AND user_id=$2 AND status IN ('open','partially_submitted') AND expires_at>now() RETURNING id) INSERT INTO photo_request_history(request_id,action) SELECT id,'cancelled' FROM cancelled RETURNING request_id`,[req.params.id,req.user.id]);
  if(!r.rowCount)return res.status(409).json({error:'Request is unavailable or already closed.'});res.json({ok:true});
 }catch(e){res.status(500).json({error:'Request could not be cancelled.'});}});
 app.get('/photo-request/:token',privacy,async(req,res)=>{try{
  const r=await publicRequest(req.params.token);if(!r)return res.status(404).send('Photo request not found.');
  if(!['open','partially_submitted'].includes(r.status)||new Date(r.expires_at)<=new Date()){await expire(pool);return res.status(410).send('This photo request is closed or expired.');}
  res.sendFile(path.join(__dirname,'public/photo-request.html'));
 }catch(e){res.status(503).send('Photo request is temporarily unavailable.');}});
 app.get('/api/public/photo-requests/:token',privacy,async(req,res)=>{try{
  const r=await publicRequest(req.params.token);if(!r)return res.status(404).json({error:'Photo request not found.'});
  if(!['open','partially_submitted'].includes(r.status)||new Date(r.expires_at)<=new Date()){await expire(pool);return res.status(410).json({error:'This photo request is closed or expired.'});}
  const received=(await pool.query('SELECT view_index FROM photo_request_photos WHERE request_id=$1',[r.id])).rows.map(p=>p.view_index);
  res.json({title:r.title,sender_name:r.sender_name,recipient_name:r.recipient_name,instructions:r.instructions,views:r.views,allow_partial:r.allow_partial,expires_at:r.expires_at,received});
 }catch(e){res.status(503).json({error:'Request is temporarily unavailable.'});}});
 app.post('/api/public/photo-requests/:token',privacy,async(req,res,next)=>{
  try{const r=await publicRequest(req.params.token);if(!r||!['open','partially_submitted'].includes(r.status)||new Date(r.expires_at)<=new Date())return res.status(410).json({error:'This photo request is closed or expired.'});next();}
  catch(e){res.status(503).json({error:'Request is temporarily unavailable.'});}
 },(req,res,next)=>upload(req,res,async error=>{if(error){await removeUploads(req.files);return res.status(400).json({error:'Use at most 8 photographs, up to 25 MB each.'});}next();}),async(req,res)=>{
  let db,committed=false;
  try{
   const files=req.files||[];if(!files.length)throw new Error('Choose the requested photos.');
   let indices,notes;try{indices=JSON.parse(req.body.view_indices);notes=JSON.parse(req.body.notes||'[]');}catch(e){throw new Error('Invalid view selection.');}
   if(!Array.isArray(indices)||indices.length!==files.length||!Array.isArray(notes)||notes.length>8)throw new Error('Invalid view selection.');
   const evidence=await inspectPhotos(files);
   db=await pool.connect();await db.query('BEGIN');const r=await publicRequest(req.params.token,db,true);
   if(!r||!['open','partially_submitted'].includes(r.status)||new Date(r.expires_at)<=new Date())throw new Error('This photo request is closed or expired.');
   const received=(await db.query('SELECT view_index FROM photo_request_photos WHERE request_id=$1',[r.id])).rows;
   const status=validateSubmission(r,received,indices),name=clean(req.body.submitter_name,200)||r.recipient_name;
   let item=null,tags=[];
   if(r.related_capture_id)tags=(await db.query('SELECT area_tags FROM captures WHERE id=$1 AND user_id=$2',[r.related_capture_id,r.user_id])).rows[0]?.area_tags||[];
   if(r.item_id){item=(await db.query('SELECT company_id,area FROM hoa_maintenance_items WHERE id=$1 FOR SHARE',[r.item_id])).rows[0];if(!item)throw new Error('Related record is unavailable.');tags=[item.area];}
   for(let n=0;n<files.length;n++){
    const view=r.views[indices[n]],note=clean(notes[n]);
    const cap=await saveExternalPhoto(db,{file:files[n],evidence:evidence[n],userId:r.user_id,name,note,title:`${r.title}: ${view}`,tags,jobId:r.job_id,itemId:r.item_id,requestId:r.id,viewName:view});
    await db.query(`INSERT INTO photo_request_photos(request_id,view_index,view_name,capture_id,submitter_name,note,original_name) VALUES($1,$2,$3,$4,$5,$6,$7)`,[r.id,indices[n],view,cap.id,name,note,clean(files[n].originalname,255)]);
   }
   await db.query('UPDATE photo_requests SET status=$1,submitted_at=now() WHERE id=$2',[status,r.id]);
   await history(db,r.id,'submission_received',{submitter_name:name,views:indices,photo_count:files.length});
   if(status==='completed')await history(db,r.id,'completed');
   if(item){await hoaHistory(r.item_id,null,'photo_request_submission',{request_id:r.id,photo_count:files.length},db);await hoaNotifyCompany(item.company_id,r.item_id,`Requested photos received: ${r.title}`,0,db);}
   await db.query('COMMIT');committed=true;res.json({ok:true,status});
  }catch(e){if(db&&!committed)await db.query('ROLLBACK');await removeUploads(req.files);const messages=['Choose the requested photos.','Invalid view selection.','This photo request is closed or expired.','Related record is unavailable.','Select a photo for a missing requested view.','Supply every requested view before submitting.','Use a supported photograph (JPEG, PNG, WebP or HEIC).'];res.status(400).json({error:messages.includes(e.message)?e.message:'Photos could not be submitted. Use supported photographs and try again.'});}
  finally{if(db)db.release();}
 });
}
module.exports={EDITIONS,eligible,validateRequest,validateSubmission,registerPhotoRequests};

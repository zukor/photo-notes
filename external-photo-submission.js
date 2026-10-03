'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const sharp=require('sharp');
const path=require('node:path');
const multer=require('multer');
function externalPhotoUpload(uploadDir){return multer({storage:multer.diskStorage({destination:uploadDir,filename:(req,file,cb)=>cb(null,crypto.randomBytes(24).toString('hex')+'.jpg')}),limits:{files:8,fileSize:25*1024*1024,fields:24,fieldSize:8000}}).array('photos',8);}
function privatePhotoToken(){return crypto.randomBytes(24).toString('base64url');}
function clean(value,max=4000){return typeof value==='string'?value.trim().slice(0,max):'';}
async function inspectPhoto(file){
 const meta=await sharp(file.path,{limitInputPixels:40000000}).metadata();
 if(!['jpeg','png','webp','heif'].includes(meta.format)||!meta.width||!meta.height)throw new Error('Use a supported photograph (JPEG, PNG, WebP or HEIC).');
 const extension={jpeg:'.jpg',png:'.png',webp:'.webp',heif:'.heic'}[meta.format];
 const filename=path.parse(file.filename).name+extension;
 if(filename!==file.filename){const target=path.join(path.dirname(file.path),filename);await fs.rename(file.path,target);file.path=target;file.filename=filename;}
 const bytes=await fs.readFile(file.path);
 return {width:meta.width,height:meta.height,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
}
async function inspectPhotos(files){
 const results=await Promise.allSettled(files.map(inspectPhoto));
 const failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;
 return results.map(r=>r.value);
}
async function saveExternalPhoto(db,{file,evidence,userId,name,note,title='',tags=[],jobId=null,itemId=null,stage='inspection',requestId=null,viewName=null}){
 const cap=(await db.query(`INSERT INTO captures(user_id,captured_by,photo_path,photo_width,photo_height,note,photo_title,area_tags,kind,job_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'note',$9) RETURNING *`,[userId,clean(name,200)||'Outside submitter',`/uploads/${file.filename}`,evidence.width,evidence.height,clean(note),clean(title,200),tags,jobId])).rows[0];
 await db.query(`INSERT INTO capture_evidence(capture_id,user_id,original_sha256,original_bytes,original_name) VALUES($1,$2,$3,$4,$5)`,[cap.id,userId,evidence.sha256,evidence.bytes,clean(file.originalname,255)]);
 if(itemId)await db.query(`INSERT INTO hoa_item_photos(item_id,capture_id,photo_stage) VALUES($1,$2,$3)`,[itemId,cap.id,stage]);
 await db.query(`INSERT INTO capture_history(capture_id,user_id,action,detail) VALUES($1,$2,'captured',$3)`,[cap.id,userId,JSON.stringify({source:'outside_photo_submission',item_id:itemId,photo_request_id:requestId,requested_view:viewName})]);
 return cap;
}
async function removeUploads(files){await Promise.all((files||[]).map(f=>fs.unlink(f.path).catch(()=>{})));}
module.exports={externalPhotoUpload,privatePhotoToken,clean,inspectPhoto,inspectPhotos,saveExternalPhoto,removeUploads};

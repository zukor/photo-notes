const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const {currentEdition,editionAccess}=require('./editions');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
class CaptureReceiptError extends Error {constructor(status,message){super(message);this.status=status;}}
async function beginCaptureReceipt(req,pool){
 const key=req.get('X-Photo-Notes-Capture-Id');
 if(!key)return {db:pool,commit:async()=>{},rollback:async()=>{},release:()=>{}};
 const edition=req.get('X-Photo-Notes-Edition');
 if(!UUID.test(key)||typeof edition!=='string')throw new CaptureReceiptError(400,'Invalid capture identity');
 const fields=Object.fromEntries(Object.entries(req.body||{}).sort(([a],[b])=>a.localeCompare(b)));
 const photo=req.file?crypto.createHash('sha256').update(await fs.readFile(req.file.path)).digest('hex'):null;
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify({edition,fields,photo})).digest('hex');
 const client=await pool.connect();let open=false;
 try{
  await client.query('BEGIN');open=true;
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${req.user.id}:${key}`]);
  const user=(await client.query('SELECT * FROM users WHERE id=$1 FOR SHARE',[req.user.id])).rows[0];
  if(!user||!user.active||!editionAccess(user).includes(edition))throw new CaptureReceiptError(403,'This version is no longer authorized for your account');
  const receipt=(await client.query('SELECT request_hash,response FROM capture_upload_receipts WHERE user_id=$1 AND request_id=$2',[req.user.id,key])).rows[0];
  if(receipt){
   if(receipt.request_hash!==fingerprint)throw new CaptureReceiptError(409,'This capture identity was already used for different content');
   await client.query('COMMIT');open=false;client.release();
   return {db:pool,replay:receipt.response,commit:async()=>{},rollback:async()=>{},release:()=>{}};
  }
  if(currentEdition(user)!==edition)throw new CaptureReceiptError(409,'Select the original Photo Notes version before retrying this photo');
  return {db:client,async commit(response){await client.query('INSERT INTO capture_upload_receipts(user_id,request_id,request_hash,response) VALUES($1,$2,$3,$4)',[req.user.id,key,fingerprint,JSON.stringify(response)]);await client.query('COMMIT');open=false;},async rollback(){if(open){await client.query('ROLLBACK');open=false;}},release(){client.release();}};
 }catch(error){if(open)await client.query('ROLLBACK');client.release();throw error;}
}
function validateCaptureAccount(req,res,next){
 if(!req.get('X-Photo-Notes-Capture-Id'))return next();
 const expected=crypto.createHash('sha256').update(String(req.user.email).trim().toLowerCase()).digest('hex');
 if(req.get('X-Photo-Notes-Account')!==expected)return res.status(403).json({error:'Account changed. Sign in to the original account before uploading this photo'});
 next();
}
module.exports={beginCaptureReceipt,CaptureReceiptError,validateCaptureAccount};

'use strict';
const crypto=require('crypto');
const QRCode=require('qrcode');
const EDITIONS=new Set(['pro','property','hoa','concrete','paving','contractor','roofer']);
const token=()=>crypto.randomBytes(32).toString('base64url');
const validToken=t=>typeof t==='string'&&/^[A-Za-z0-9_-]{43}$/.test(t);
// Target adapters are intentionally independent of Areas, Photo Sets and Photo Requests.
async function target(pool,user,type,id,edition){
 if(!EDITIONS.has(edition)||!Number.isSafeInteger(Number(id))||Number(id)<1)return null;
 if(type==='asset'&&['property','hoa'].includes(edition))return (await pool.query(`SELECT a.id,a.name,c.name property FROM hoa_assets a JOIN hoa_communities c ON c.id=a.community_id WHERE a.id=$1 AND a.active=true AND c.active=true AND a.company_id=(SELECT company_id FROM hoa_company_members WHERE user_id=$2 ORDER BY company_id LIMIT 1)`,[id,user])).rows[0]||null;
 if(type==='note')return (await pool.query(`SELECT id,COALESCE(NULLIF(photo_title,''),'Saved Photo Note') name FROM captures WHERE id=$1 AND user_id=$2`,[id,user])).rows[0]||null;
 return null;
}
function registerQrCodes(app,{pool,requireAuth,currentProduct}){
 const wrap=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(e){console.error('[qr]',e.message);res.status(500).json({error:'QR code unavailable.'});}};
 const access=async(req,res,type,id)=>{const product=await currentProduct(req.user.id),edition=product==='general'?'pro':product,record=await target(pool,req.user.id,type,id,edition);if(!record)res.status(404).json({error:'Photo Notes context unavailable. Sign in with an authorized account.'});return record;};
 const link=(req,t)=>{const host=req.get('host'),protocol=/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)?req.protocol:'https';return `${protocol}://${host}/qr/${t}`;};
 const result=(req,row,record)=>({active:!!row&&!row.disabled,url:row&&!row.disabled?link(req,row.token):null,name:record.name,property:record.property||'',type:row?.target_type});
 // This public route reveals no record metadata and offers no uploads.
 app.get('/qr/:token',(req,res)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});if(!validToken(req.params.token))return res.status(404).send('Photo Notes context unavailable.');res.redirect('/?qr='+encodeURIComponent(req.params.token));});
 app.get('/api/qr/resolve/:token',requireAuth,wrap(async(req,res)=>{
  if(!validToken(req.params.token))return res.status(404).json({error:'Photo Notes context unavailable.'});
  const row=(await pool.query('SELECT * FROM photo_context_qr WHERE token=$1 AND disabled=false',[req.params.token])).rows[0];
  if(!row)return res.status(404).json({error:'Photo Notes context unavailable. This label may have been disabled or replaced.'});
  const record=await access(req,res,row.target_type,row.target_id);if(record)res.json({type:row.target_type,id:Number(row.target_id),...result(req,row,record)});
 }));
 app.get('/api/qr/:type/:id',requireAuth,wrap(async(req,res)=>{
  const record=await access(req,res,req.params.type,req.params.id);if(!record)return;
  const row=(await pool.query('SELECT * FROM photo_context_qr WHERE target_type=$1 AND target_id=$2',[req.params.type,req.params.id])).rows[0];res.json(result(req,row,record));
 }));
 app.post('/api/qr/:type/:id',requireAuth,wrap(async(req,res)=>{
  const {type,id}=req.params,record=await access(req,res,type,id);if(!record)return;
  const action=req.body?.action||'create';if(!['create','reissue','disable'].includes(action))return res.status(400).json({error:'Invalid QR action.'});
  let row;
  if(action==='disable')row=(await pool.query('UPDATE photo_context_qr SET disabled=true,updated_at=now() WHERE target_type=$1 AND target_id=$2 RETURNING *',[type,id])).rows[0];
  else row=(await pool.query(`INSERT INTO photo_context_qr(target_type,target_id,token,created_by) VALUES($1,$2,$3,$4) ON CONFLICT(target_type,target_id) DO UPDATE SET token=CASE WHEN $5='reissue' THEN EXCLUDED.token ELSE photo_context_qr.token END,disabled=CASE WHEN $5='reissue' THEN false ELSE photo_context_qr.disabled END,updated_at=now() RETURNING *`,[type,id,token(),req.user.id,action])).rows[0];
  res.json(result(req,row,record));
 }));
 app.get('/api/qr/:type/:id/image',requireAuth,wrap(async(req,res)=>{
  if(!await access(req,res,req.params.type,req.params.id))return;
  const row=(await pool.query('SELECT * FROM photo_context_qr WHERE target_type=$1 AND target_id=$2 AND disabled=false',[req.params.type,req.params.id])).rows[0];if(!row)return res.status(404).json({error:'QR code unavailable.'});
  res.type('png').send(await QRCode.toBuffer(link(req,row.token),{width:900,margin:4,errorCorrectionLevel:'M'}));
 }));
}
module.exports={registerQrCodes,target,EDITIONS,token,validToken};

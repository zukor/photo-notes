'use strict';
const EDITIONS=new Set(['general','pro','paving','asphalt','concrete','property','hoa','contractor','roofer']);
const SCHEMA=`ALTER TABLE captures ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT false;`;
function validate(body){
 if(!body||!Array.isArray(body.ids)||!body.ids.length||body.ids.length>500)return null;
 if(body.ids.some(id=>!Number.isSafeInteger(id)||id<=0||id>2147483647))return null;
 const keys=Object.keys(body).filter(k=>k!=='ids');
 if(!keys.length||keys.some(k=>!['favorite','flagged'].includes(k)||typeof body[k]!=='boolean'))return null;
 return {ids:[...new Set(body.ids)],keys};
}
function registerPhotoMarkers(app,{pool,requireAuth,currentProduct}){
 app.post('/api/photo-markers',requireAuth,async(req,res)=>{
  let db;
  try{
   if(!EDITIONS.has(await currentProduct(req.user.id)))return res.status(403).json({error:'Pro edition required'});
   const change=validate(req.body);if(!change)return res.status(400).json({error:'Choose photos and a valid marker change'});
   db=await pool.connect();await db.query('BEGIN');
   const owned=(await db.query('SELECT id FROM captures WHERE user_id=$1 AND id=ANY($2::int[]) AND photo_path IS NOT NULL FOR UPDATE',[req.user.id,change.ids])).rows;
   if(owned.length!==change.ids.length){await db.query('ROLLBACK');return res.status(404).json({error:'One or more photos are unavailable'});}
   const values=[req.user.id,change.ids,...change.keys.map(k=>req.body[k])];
   const rows=(await db.query(`UPDATE captures SET ${change.keys.map((k,i)=>`${k}=$${i+3}`).join(',')} WHERE user_id=$1 AND id=ANY($2::int[]) RETURNING id,favorite,flagged`,values)).rows;
   await db.query('COMMIT');res.json(rows);
  }catch(e){if(db)await db.query('ROLLBACK');res.status(503).json({error:'Markers could not be saved. Please try again.'});}finally{db?.release();}
 });
}
module.exports={EDITIONS,SCHEMA,validate,registerPhotoMarkers};

'use strict';
const EDITIONS=new Set(['general','pro','property','hoa','paving','concrete','contractor','roofer']);
function coordinates(lat,lng){return typeof lat==='number'&&typeof lng==='number'&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;}
function registerLocationIntelligence(app,{pool,requireAuth,currentProduct}){
 const access=async(db,id,user,lock=false)=> (await db.query(`SELECT c.* FROM captures c WHERE c.id=$1 AND (c.user_id=$2 OR EXISTS (SELECT 1 FROM hoa_maintenance_items i JOIN hoa_company_members m ON m.company_id=i.company_id WHERE i.capture_id=c.id AND m.user_id=$2) OR EXISTS (SELECT 1 FROM hoa_item_photos p JOIN hoa_maintenance_items i ON i.id=p.item_id JOIN hoa_company_members m ON m.company_id=i.company_id WHERE p.capture_id=c.id AND m.user_id=$2) OR EXISTS (SELECT 1 FROM hoa_assets a JOIN hoa_asset_photos p ON p.asset_id=a.id JOIN hoa_company_members m ON m.company_id=a.company_id WHERE p.capture_id=c.id AND m.user_id=$2))${lock?' FOR UPDATE OF c':''}`,[id,user])).rows[0];
 app.get('/api/captures/:id/location',requireAuth,async(req,res)=>{try{if(!Number.isInteger(Number(req.params.id))||Number(req.params.id)<=0)return res.status(400).json({error:'Invalid photo ID'});if(!EDITIONS.has(await currentProduct(req.user.id)))return res.status(403).json({error:'Location Intelligence unavailable'});const c=await access(pool,Number(req.params.id),req.user.id);if(!c)return res.status(404).json({error:'Photo not found'});res.json(c);}catch(e){res.status(500).json({error:'Location could not load'});}});
 app.post('/api/captures/:id/location',requireAuth,async(req,res)=>{
  let db;try{
   if(!Number.isInteger(Number(req.params.id))||Number(req.params.id)<=0)return res.status(400).json({error:'Invalid photo ID'});
   if(!EDITIONS.has(await currentProduct(req.user.id)))return res.status(403).json({error:'Location Intelligence unavailable'});
   const b=req.body||{},clear=b.subject_latitude===null&&b.subject_longitude===null;
   if(!clear&&!coordinates(b.subject_latitude,b.subject_longitude))return res.status(400).json({error:'Valid Subject Location coordinates required'});
   if(typeof b.location_description!=='string'||b.location_description.length>1000)return res.status(400).json({error:'Description must be at most 1000 characters'});
   db=await pool.connect();await db.query('BEGIN');const c=await access(db,Number(req.params.id),req.user.id,true);if(!c){await db.query('ROLLBACK');return res.status(404).json({error:'Photo not found'});}
   const after={subject_latitude:clear?null:b.subject_latitude,subject_longitude:clear?null:b.subject_longitude,location_description:b.location_description.trim()||null};
   const saved=(await db.query(`UPDATE captures SET subject_latitude=$1,subject_longitude=$2,location_description=$3 WHERE id=$4 RETURNING *`,[after.subject_latitude,after.subject_longitude,after.location_description,c.id])).rows[0];
   await db.query(`INSERT INTO capture_history(capture_id,user_id,action,detail) VALUES($1,$2,'subject_location_updated',$3)`,[c.id,c.user_id,JSON.stringify({actor_id:req.user.id,before:{subject_latitude:c.subject_latitude,subject_longitude:c.subject_longitude,location_description:c.location_description},after,fields:['Subject Location','Location Description']})]);
   await db.query('COMMIT');res.json(saved);
  }catch(e){if(db)await db.query('ROLLBACK');res.status(500).json({error:'Location could not save'});}finally{db?.release();}
 });
}
module.exports={EDITIONS,coordinates,registerLocationIntelligence};

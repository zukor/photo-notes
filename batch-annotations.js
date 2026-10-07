const templates=require('./public/annotation-templates');
function registerBatchAnnotations(app,{pool,requireAuth}){
 app.get('/api/captures/:id/annotation-preview',requireAuth,async(req,res)=>{try{const row=(await pool.query('SELECT * FROM captures WHERE id=$1 AND user_id=$2',[Number(req.params.id),req.user.id])).rows[0];return row?res.json(row):res.status(404).json({error:'Photo not found'});}catch{res.status(500).json({error:'Photo could not be opened'});}});
 app.post('/api/captures/annotations',requireAuth,async(req,res)=>{
  const b=req.body||{},ids=Array.isArray(b.ids)?[...new Set(b.ids)]:[];
  if(!ids.length||ids.length>500||ids.some(id=>!Number.isSafeInteger(id)||id<1)||!Object.hasOwn(templates,b.template)||!['add','replace'].includes(b.mode))return res.status(400).json({error:'Select photos, an annotation template, and Add or Replace.'});
  if(b.mode==='replace'&&b.confirm_replace!==true)return res.status(400).json({error:'Confirm replacement of existing markings.'});
  const c=await pool.connect();try{
   await c.query('BEGIN');const rows=(await c.query('SELECT id,photo_path,overlays FROM captures WHERE user_id=$1 AND id=ANY($2::int[]) ORDER BY id FOR UPDATE',[req.user.id,ids])).rows;
   if(rows.length!==ids.length||rows.some(row=>!row.photo_path)){await c.query('ROLLBACK');return res.status(409).json({error:'Every selected item must be an available photo owned by your account. Refresh the list and check your selection.'});}
   const updates=rows.map(row=>({id:row.id,overlays:b.mode==='add'?[...(Array.isArray(row.overlays)?row.overlays:[]),...templates[b.template]]:templates[b.template]}));
   if(updates.some(row=>row.overlays.length>20)){await c.query('ROLLBACK');return res.status(409).json({error:'A selected photo would exceed 20 markings. Remove some markings or explicitly choose Replace existing markings.'});}
   for(const row of updates){await c.query('UPDATE captures SET overlays=$1::jsonb WHERE id=$2 AND user_id=$3',[JSON.stringify(row.overlays),row.id,req.user.id]);await c.query('INSERT INTO capture_history(capture_id,user_id,action,detail) VALUES($1,$2,$3,$4::jsonb)',[row.id,req.user.id,'details_updated',JSON.stringify({fields:['overlays'],annotation_template:b.template,mode:b.mode})]);}
   await c.query('COMMIT');res.json({ok:true,updated:updates.length,ids:updates.map(row=>row.id)});
  }catch(e){await c.query('ROLLBACK');console.error('[batch-annotations]',e.message);res.status(500).json({error:'Templates could not be applied. No batch changes were saved.'});}finally{c.release();}
 });
}
module.exports={registerBatchAnnotations};

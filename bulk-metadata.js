'use strict';
const crypto=require('node:crypto');
const EDITIONS=new Set(['general','pro','paving','asphalt','concrete','property','hoa','contractor','roofer']);
// Explicit registry: future safe custom fields can be added here without widening the SQL allowlist.
function fieldsFor(edition){
 const fields={area_tags:{label:'Topic',type:'topics'},job_id:{label:'Job',type:'job'},urgency:{label:'Urgency',options:[['standard','Standard'],['urgent','Urgent']]},favorite:{label:'Favorite',type:'boolean',options:[[true,'Mark Favorite'],[false,'Remove Favorite']]},flagged:{label:'Flagged',type:'boolean',options:[[true,'Flag'],[false,'Remove Flag']]}};
 if(['paving','asphalt'].includes(edition))fields.paving_photo_reason={label:'Photo Reason',options:[['proposal','Proposal Photo']],clear:true};
 return fields;
}
function validate(body,edition){
 if(!body||!Array.isArray(body.ids)||!body.ids.length||body.ids.length>500||body.ids.some(id=>!Number.isSafeInteger(id)||id<=0||id>2147483647))throw new Error('Select 1 to 500 Photo Notes.');
 if(!body.metadata||typeof body.metadata!=='object'||Array.isArray(body.metadata))throw new Error('Choose valid metadata changes.');
 if(Object.keys(body).some(k=>!['ids','metadata','preview','snapshot'].includes(k)))throw new Error('Unsupported batch option.');
 const fields=fieldsFor(edition),metadata={};
 for(const [key,value] of Object.entries(body.metadata)){
  const field=fields[key];if(!field)throw new Error('This field cannot be bulk edited.');
  if(field.type==='topics'){
   if(!Array.isArray(value)||value.length>50||value.some(v=>typeof v!=='string'||!v.trim()||v.trim().length>100))throw new Error('Choose valid Topics.');
   metadata[key]=[...new Set(value.map(v=>v.trim()))];
  }else if(field.type==='job'){
   if(value!==null&&(!Number.isSafeInteger(value)||value<=0||value>2147483647))throw new Error('Choose a valid Job.');metadata[key]=value;
  }else{if(!(value===null&&field.clear)&&!field.options.some(o=>o[0]===value))throw new Error('Choose a valid '+field.label+'.');metadata[key]=value;}
 }
 if(body.preview!==true&&!Object.keys(metadata).length)throw new Error('Choose at least one change.');
 return {ids:[...new Set(body.ids)].sort((a,b)=>a-b),metadata,fields};
}
const canonical=value=>Array.isArray(value)?[...value].sort():value;
function snapshot(rows,metadata){return crypto.createHash('sha256').update(JSON.stringify({metadata,rows:rows.map(row=>({id:row.id,values:Object.keys(metadata).map(k=>canonical(row[k]??null))})).sort((a,b)=>a.id-b.id)})).digest('hex');}
function createHandler({pool,currentProduct}){
 return async(req,res)=>{
  let db,ids=[];
  try{
   const edition=await currentProduct(req.user.id);if(!EDITIONS.has(edition))return res.status(403).json({error:'Bulk Metadata Editing requires a Pro edition.',updated:0,not_updated:req.body.ids?.length||0});
   let change;try{change=validate(req.body,edition);}catch(e){return res.status(400).json({error:e.message,updated:0,not_updated:req.body.ids?.length||0});}
   ids=change.ids;db=await pool.connect();await db.query('BEGIN');
   const rows=(await db.query(`SELECT id,${Object.keys(change.fields).join(',')} FROM captures WHERE user_id=$1 AND id=ANY($2::int[]) AND photo_path IS NOT NULL ORDER BY id FOR UPDATE`,[req.user.id,ids])).rows;
   if(rows.length!==ids.length){await db.query('ROLLBACK');return res.status(404).json({error:'One or more selected Photo Notes are unavailable or cannot be edited. Nothing was changed.',updated:0,not_updated:ids.length});}
   if(change.metadata.job_id!=null&&!(await db.query('SELECT id FROM jobs WHERE id=$1 AND user_id=$2',[change.metadata.job_id,req.user.id])).rowCount){await db.query('ROLLBACK');return res.status(400).json({error:'Job is unavailable. Nothing was changed.',updated:0,not_updated:ids.length});}
   const token=snapshot(rows,change.metadata);
   if(req.body.preview===true){await db.query('COMMIT');return res.json({count:rows.length,fields:change.fields,rows,snapshot:token});}
   if(req.body.snapshot!==token){await db.query('ROLLBACK');return res.status(409).json({error:'Selected metadata changed since the review. Review the changes again. Nothing was changed.',updated:0,not_updated:ids.length});}
   const keys=Object.keys(change.metadata),history=rows.map(row=>{
    const changed=keys.filter(k=>JSON.stringify(canonical(row[k]??null))!==JSON.stringify(canonical(change.metadata[k])));
    return {id:row.id,detail:{bulk:true,selected_count:ids.length,fields:changed.map(k=>change.fields[k].label),before:Object.fromEntries(changed.map(k=>[k,row[k]??null])),after:Object.fromEntries(changed.map(k=>[k,change.metadata[k]]))}};
   }).filter(h=>h.detail.fields.length);
   if(history.length){
    await db.query(`UPDATE captures SET ${keys.map((k,i)=>`${k}=$${i+3}`).join(',')} WHERE user_id=$1 AND id=ANY($2::int[])`,[req.user.id,history.map(h=>h.id),...keys.map(k=>change.metadata[k])]);
    await db.query(`INSERT INTO capture_history(capture_id,user_id,action,detail) SELECT h.id,$1,'details_updated',h.detail FROM jsonb_to_recordset($2::jsonb) AS h(id int,detail jsonb)`,[req.user.id,JSON.stringify(history)]);
   }
   await db.query('COMMIT');res.json({ok:true,updated:history.length,unchanged:ids.length-history.length,not_updated:0});
  }catch(e){if(db)await db.query('ROLLBACK').catch(()=>{});console.error('[bulk.metadata]',e.message);res.status(503).json({error:'Bulk changes could not be saved. Nothing was changed. Review and try again.',updated:0,not_updated:ids.length});}finally{db?.release();}
 };
}
module.exports={EDITIONS,fieldsFor,validate,snapshot,createHandler};

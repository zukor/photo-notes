function validateFootprint(body,computeZone){
  const name=typeof body.name==='string'?body.name.trim():'';
  if(!name||name.length>120)throw new Error('Enter an area name of 1–120 characters');
  const captureId=Number(body.capture_id);
  if(!Number.isInteger(captureId)||captureId<1)throw new Error('Choose a saved photo');
  const points=body.points||[];
  if(!Array.isArray(points)||points.length>100||points.some(p=>!p||typeof p.lat!=='number'||typeof p.lng!=='number'||!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>85||Math.abs(p.lng)>180))throw new Error('Invalid map corners');
  let mapArea=null;
  if(points.length){
    if(Math.max(...points.map(p=>p.lat))-Math.min(...points.map(p=>p.lat))>0.1||Math.max(...points.map(p=>p.lng))-Math.min(...points.map(p=>p.lng))>0.1)throw new Error('Keep the footprint within one job site');
    const calculated=computeZone('polygon',points);
    if(!calculated.ok||!Number.isFinite(calculated.area_sqft)||calculated.area_sqft<=0)throw new Error(calculated.error||'Draw an area with at least three distinct corners');
    mapArea=calculated.area_sqft;
  }
  const provided=v=>v!==null&&v!==undefined&&v!=='';
  let length=null,width=null,method=null;
  if(provided(body.field_length_ft)||provided(body.field_width_ft)){
    length=Number(body.field_length_ft);width=Number(body.field_width_ft);
    if(!Number.isFinite(length)||!Number.isFinite(width)||length<=0||width<=0||length>10000||width>10000)throw new Error('Enter positive field length and width in feet, up to 10,000');
    if(!['tape','laser'].includes(body.field_method))throw new Error('Choose Tape measure or Laser measure');
    method=body.field_method;
  }
  if(mapArea===null&&length===null)throw new Error('Trace a map area or enter measured dimensions');
  const notes=typeof body.notes==='string'?body.notes.trim():'';
  if(notes.length>2000)throw new Error('Keep notes within 2,000 characters');
  return {captureId,name,points:points.map(p=>({lat:p.lat,lng:p.lng})),mapArea,length,width,method,fieldArea:length===null?null:length*width,notes};
}
function footprintSummary(f){
  const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:1});
  return [f.name,f.map_area_sqft!=null?`Map estimate: ${fmt(f.map_area_sqft)} sq ft (overhead footprint)`:null,f.field_area_sqft!=null?`Field dimensions (${f.field_method==='laser'?'laser':'tape'}, user entered): ${fmt(f.field_length_ft)} × ${fmt(f.field_width_ft)} ft = ${fmt(f.field_area_sqft)} sq ft (rectangle)`:null,f.notes||null].filter(Boolean).join(' | ');
}
function registerConcreteFootprints(app,{pool,requireAuth,requireConcrete,computeZone}){
  const handlers=[requireAuth,requireConcrete];
  app.get('/api/concrete/footprints',...handlers,async(req,res)=>{
    try{const {rows}=await pool.query('SELECT f.*,c.photo_title,c.job_id FROM concrete_footprints f JOIN captures c ON c.id=f.capture_id AND c.user_id=f.user_id WHERE f.user_id=$1 ORDER BY f.updated_at DESC',[req.user.id]);res.json(rows);}catch(e){res.status(500).json({error:'Areas could not be loaded'});}
  });
  async function save(req,res){
    let data;try{data=validateFootprint(req.body||{},computeZone);}catch(e){return res.status(400).json({error:e.message});}
    const id=req.params.id===undefined?null:Number(req.params.id);
    if(id!==null&&(!Number.isInteger(id)||id<1))return res.status(400).json({error:'Invalid area'});
    try{
      const owned=await pool.query('SELECT id FROM captures WHERE id=$1 AND user_id=$2 AND photo_path IS NOT NULL',[data.captureId,req.user.id]);
      if(!owned.rowCount)return res.status(404).json({error:'Photo not found'});
      const args=[req.user.id,data.captureId,data.name,JSON.stringify(data.points),data.mapArea,data.length,data.width,data.method,data.fieldArea,data.notes];
      const sql=id===null?`INSERT INTO concrete_footprints(user_id,capture_id,name,points,map_area_sqft,field_length_ft,field_width_ft,field_method,field_area_sqft,notes) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10) RETURNING *`:`UPDATE concrete_footprints SET capture_id=$2,name=$3,points=$4::jsonb,map_area_sqft=$5,field_length_ft=$6,field_width_ft=$7,field_method=$8,field_area_sqft=$9,notes=$10,updated_at=now() WHERE user_id=$1 AND id=$11 RETURNING *`;
      if(id!==null)args.push(id);
      const result=await pool.query(sql,args);if(!result.rowCount)return res.status(404).json({error:'Area not found'});res.json(result.rows[0]);
    }catch(e){res.status(500).json({error:'Area could not be saved; try again'});}
  }
  app.post('/api/concrete/footprints',...handlers,save);
  app.post('/api/concrete/footprints/:id',...handlers,save);
}
module.exports={validateFootprint,footprintSummary,registerConcreteFootprints};

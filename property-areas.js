'use strict';
const SCHEMA=`
CREATE TABLE IF NOT EXISTS property_areas (
 id SERIAL PRIMARY KEY, community_id INTEGER NOT NULL REFERENCES hoa_communities(id),
 name TEXT NOT NULL CHECK(length(trim(name))>0), description TEXT,
 active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS property_areas_name_idx ON property_areas(community_id,lower(name));
${['captures','hoa_maintenance_items','hoa_assets','hoa_inspection_stops','hoa_visit_stops'].map(t=>`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS property_area_id INTEGER REFERENCES property_areas(id); CREATE INDEX IF NOT EXISTS ${t}_property_area_idx ON ${t}(property_area_id);`).join('\n')}
ALTER TABLE captures ADD COLUMN IF NOT EXISTS property_community_id INTEGER REFERENCES hoa_communities(id);
`;
async function validate(db,company,community,value,previous=null){
 if(value==null||value==='')return null;
 const id=Number(value);if(!Number.isSafeInteger(id)||id<=0)throw Object.assign(new Error('Invalid Area'),{status:400});
 const row=(await db.query(`SELECT a.* FROM property_areas a JOIN hoa_communities c ON c.id=a.community_id WHERE a.id=$1 AND a.community_id=$2 AND c.company_id=$3`,[id,community,company])).rows[0];
 if(!row||(!row.active&&id!==previous))throw Object.assign(new Error('Select an active Area belonging to this Property'),{status:400});return id;
}
function register(app,{pool,requireAuth,requireHoa,currentProduct}){
 const gate=async(req,res,next)=>{if(await currentProduct(req.user.id)!=='property')return res.status(403).json({error:'Property Manager Pro required'});next();};
 const run=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Area operation failed'});}};
 app.get('/api/property/areas',requireAuth,requireHoa,gate,run(async(req,res)=>{
 const vals=[req.hoaCompany.id],where=['c.company_id=$1'];if(req.query.community_id){vals.push(Number(req.query.community_id));where.push('a.community_id=$2');}
 res.json((await pool.query(`SELECT a.*,c.name community_name FROM property_areas a JOIN hoa_communities c ON c.id=a.community_id WHERE ${where.join(' AND ')} ORDER BY c.name,a.name`,vals)).rows);
 }));
 app.post('/api/property/areas',requireAuth,requireHoa,gate,run(async(req,res)=>{
 const b=req.body||{},name=String(b.name||'').trim().slice(0,200);if(!name)return res.status(400).json({error:'Area Name required'});
 const property=(await pool.query('SELECT id FROM hoa_communities WHERE id=$1 AND company_id=$2 AND active=true',[Number(b.community_id),req.hoaCompany.id])).rows[0];if(!property)return res.status(404).json({error:'Property not found'});
 try{res.json((await pool.query('INSERT INTO property_areas(community_id,name,description) VALUES($1,$2,$3) RETURNING *',[property.id,name,String(b.description||'').trim().slice(0,2000)])).rows[0]);}catch(e){if(e.code==='23505')return res.status(409).json({error:'An Area with that name already exists in this Property'});throw e;}
 }));
 app.post('/api/property/areas/:id',requireAuth,requireHoa,gate,run(async(req,res)=>{
 const b=req.body||{},name=String(b.name||'').trim().slice(0,200);if(!name||typeof b.active!=='boolean')return res.status(400).json({error:'Area Name and Active status required'});
 try{const row=(await pool.query(`UPDATE property_areas a SET name=$1,description=$2,active=$3 FROM hoa_communities c WHERE a.id=$4 AND c.id=a.community_id AND c.company_id=$5 RETURNING a.*`,[name,String(b.description||'').trim().slice(0,2000),b.active,Number(req.params.id),req.hoaCompany.id])).rows[0];if(!row)return res.status(404).json({error:'Area not found'});res.json(row);}catch(e){if(e.code==='23505')return res.status(409).json({error:'An Area with that name already exists in this Property'});throw e;}
 }));
 app.post('/api/property/associations/:type/:id',requireAuth,requireHoa,gate,run(async(req,res)=>{
 const tables={asset:'hoa_assets',item:'hoa_maintenance_items',capture:'captures'};const table=tables[req.params.type];if(!table)return res.status(400).json({error:'Invalid record type'});
 const id=Number(req.params.id),row=(await pool.query(table==='captures'?'SELECT * FROM captures WHERE id=$1 AND user_id=$2':`SELECT * FROM ${table} WHERE id=$1 AND company_id=$2`,[id,table==='captures'?req.user.id:req.hoaCompany.id])).rows[0];if(!row)return res.status(404).json({error:'Record not found'});
 const community=table==='captures'?Number(req.body.community_id):row.community_id;
 if(!(await pool.query('SELECT id FROM hoa_communities WHERE id=$1 AND company_id=$2',[community,req.hoaCompany.id])).rowCount)return res.status(400).json({error:'Property required'});
 const area=await validate(pool,req.hoaCompany.id,community,req.body.property_area_id,row.property_area_id);
 await pool.query(`UPDATE ${table} SET property_area_id=$1${table==='captures'?',property_community_id=$3':''} WHERE id=$2`,table==='captures'?[area,id,community]:[area,id]);res.json({ok:true});
 }));
}
module.exports={SCHEMA,validate,register};

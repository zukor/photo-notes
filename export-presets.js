// Versioned, user-owned packaging defaults. No destinations or photo membership.
const SCHEMA=`CREATE TABLE IF NOT EXISTS export_presets (
 id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', config JSONB NOT NULL,
 is_default BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS export_presets_owner ON export_presets(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS export_presets_default ON export_presets(user_id) WHERE is_default;`;
const supported=user=>user?.plan==='pro'&&['general','paving','asphalt','concrete','property','hoa','contractor','roofer'].includes(user.pro_type);
function normalize(value){
 const v=value&&typeof value==='object'?value:{},warnings=[],config={version:1};
 if(v.version&&v.version!==1)warnings.push('This preset uses a newer configuration version. Supported settings were applied.');
 if(Array.isArray(value))warnings.push('Invalid preset configuration was replaced with defaults.');
 const choices={format:['pdf','docx','bundle'],resolution:['standard','print','web'],font:['Arial','Aptos','Calibri','Georgia','Times New Roman'],photo_layout:['one_per_page','two_per_page']};
 config.format=choices.format.includes(v.format)?v.format:'pdf';config.resolution=choices.resolution.includes(v.resolution)?v.resolution:'standard';
 config.layout={};const l=v.layout||{};
 for(const key of ['cover_page','header','footer','page_numbers'])if(typeof l[key]==='boolean')config.layout[key]=l[key];
 for(const key of ['font','photo_layout'])if(choices[key].includes(l[key]))config.layout[key]=l[key];else if(l[key]!=null)warnings.push(`Unavailable ${key} was skipped.`);
 if(/^#[0-9a-f]{6}$/i.test(l.accent||''))config.layout.accent=l.accent;else if(l.accent!=null)warnings.push('Unavailable accent was skipped.');
 for(const key of Object.keys(l))if(!['cover_page','header','footer','page_numbers','font','photo_layout','accent'].includes(key))warnings.push(`Unavailable layout ${key} was skipped.`);
 config.branding={};for(const [key,max] of Object.entries({company_name:160,header_text:200,footer_text:240}))if(typeof v.branding?.[key]==='string')config.branding[key]=v.branding[key].slice(0,max);
 config.logo=v.logo!==false;
 for(const key of Object.keys(v))if(!['version','format','resolution','layout','branding','logo'].includes(key))warnings.push(`Unavailable ${key} was skipped.`);
 for(const key of ['format','resolution'])if(v[key]!=null&&!choices[key].includes(v[key]))warnings.push(`Unavailable ${key} was replaced with a supported default.`);
 return {config,warnings};
}
function register(app,{pool,requireAuth}){
 app.use('/api/export-presets',requireAuth,(req,res,next)=>{res.set('Cache-Control','no-store');supported(req.user)?next():res.status(403).json({error:'Export Presets require an applicable Pro edition.'});});
 app.get('/api/export-presets',async(req,res)=>{try{const result=await pool.query('SELECT id,name,description,config,is_default FROM export_presets WHERE user_id=$1 ORDER BY name,id',[req.user.id]);res.json(result.rows.map(row=>({...row,...normalize(row.config)})));}catch{res.status(503).json({error:'Presets are unavailable. Try again.'});}});
 const save=async(req,res)=>{
 const b=req.body||{},name=typeof b.name==='string'?b.name.trim():'';
 if(!name||name.length>80||typeof b.description!=='string'||b.description.length>500||!b.config||typeof b.config!=='object')return res.status(400).json({error:'Enter a preset name (up to 80 characters) and valid settings.'});
 if(req.params.id&&!/^\d{1,9}$/.test(req.params.id))return res.status(404).json({error:'Preset not found.'});
 let client;try{client=await pool.connect();await client.query('BEGIN');await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[req.user.id]);
 if(req.params.id&&!(await client.query('SELECT id FROM export_presets WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id])).rows.length){await client.query('ROLLBACK');return res.status(404).json({error:'Preset not found.'});}
 if(b.is_default===true)await client.query('UPDATE export_presets SET is_default=false WHERE user_id=$1',[req.user.id]);
 const {config,warnings}=normalize(b.config),args=[name,b.description,JSON.stringify(config),b.is_default===true,req.user.id];
 const result=req.params.id?await client.query('UPDATE export_presets SET name=$1,description=$2,config=$3,is_default=$4 WHERE user_id=$5 AND id=$6 RETURNING *',[...args,req.params.id]):await client.query('INSERT INTO export_presets(name,description,config,is_default,user_id) VALUES($1,$2,$3,$4,$5) RETURNING *',args);
 await client.query('COMMIT');res.status(req.params.id?200:201).json({...result.rows[0],warnings});
 }catch{if(client)await client.query('ROLLBACK');res.status(503).json({error:'Could not save preset. Try again.'});}finally{client?.release();}
 };
 const guard=(req,res,next)=>req.get('X-Photo-Notes-Presets')==='1'?next():res.status(403).json({error:'Use Photo Notes to update presets.'});
 app.post('/api/export-presets',guard,save);app.put('/api/export-presets/:id',guard,save);
 app.delete('/api/export-presets/:id',guard,async(req,res)=>{if(!/^\d{1,9}$/.test(req.params.id))return res.status(404).json({error:'Preset not found.'});try{const r=await pool.query('DELETE FROM export_presets WHERE id=$1 AND user_id=$2 RETURNING id',[req.params.id,req.user.id]);res.status(r.rows.length?200:404).json(r.rows.length?{ok:true}:{error:'Preset not found.'});}catch{res.status(503).json({error:'Could not delete preset.'});}});
}
module.exports={SCHEMA,supported,normalize,register};

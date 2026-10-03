'use strict';
const EDITIONS=['pro','paving','concrete','property','hoa','contractor','roofer'];
const normalizeEdition=e=>e==='general'?'pro':e==='asphalt'?'paving':e;
const TYPES=['text','number','date','boolean','choice'];
const LIMITS={active:12,name:60,text:250,prompt:300,choices:12,option:60};
const SCHEMA=`CREATE TABLE IF NOT EXISTS custom_field_definitions (
 id UUID PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 scope TEXT NOT NULL,edition TEXT,name TEXT NOT NULL,type TEXT NOT NULL,prompt TEXT NOT NULL DEFAULT '',
 required BOOLEAN NOT NULL DEFAULT false,active BOOLEAN NOT NULL DEFAULT true,
 options JSONB NOT NULL DEFAULT '[]',revision INTEGER NOT NULL DEFAULT 1,
 versions JSONB NOT NULL DEFAULT '{}',updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS custom_fields_owner ON custom_field_definitions(user_id);
 ALTER TABLE captures ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '[]';`;
function fail(message,status=400){throw Object.assign(Error(message),{status});}
function definition(b){
 if(!b||typeof b.name!=='string'||!b.name.trim()||b.name.trim().length>LIMITS.name)fail('Field Name must be 1 to 60 characters');
 if(!TYPES.includes(b.type)||!['general','edition'].includes(b.scope))fail('Choose a supported type and scope');
 if(b.scope==='edition'&&!EDITIONS.includes(b.edition))fail('Choose a Pro edition');
 if(typeof b.prompt!=='string'||b.prompt.length>LIMITS.prompt||typeof b.required!=='boolean'||typeof b.active!=='boolean')fail('Invalid prompt or field settings');
 let options=[];
 if(b.type==='choice'){
  if(!Array.isArray(b.options)||b.options.length<1||b.options.length>LIMITS.choices||b.options.some(v=>typeof v!=='string'||!v.trim()||v.trim().length>LIMITS.option))fail('Use 1 to 12 choices, each up to 60 characters');
  options=b.options.map(v=>v.trim());if(new Set(options).size!==options.length)fail('Choices must be unique');
 }
 return {name:b.name.trim(),type:b.type,scope:b.scope,edition:b.scope==='edition'?b.edition:null,prompt:b.prompt,required:b.required,active:b.active,options};
}
function value(d,v){
 if(v===null||v===undefined||v==='')return null;
 if(d.type==='text'){if(typeof v!=='string'||v.length>LIMITS.text)fail(d.name+': use up to 250 characters');return v.trim()||null;}
 if(d.type==='number'){if(typeof v!=='number'||!Number.isFinite(v))fail(d.name+': enter a finite number');return v;}
 if(d.type==='boolean'){if(typeof v!=='boolean')fail(d.name+': choose Yes or No');return v;}
 if(d.type==='date'){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail(d.name+': enter a valid date');return v;}
 if(d.type==='choice'){if(!d.options.includes(v))fail(d.name+': choose an available option');return v;}
 fail('Unsupported field type');
}
async function captureValues(db,userId,edition,input,{previous=[],editing=false}={}){
 edition=normalizeEdition(edition);
 let items=input;try{if(typeof input==='string')items=JSON.parse(input);}catch{fail('Invalid Additional Details');}
 if(items==null)items=[];
 if(!Array.isArray(items)||items.length>36)fail('Too many Additional Details');
 const defs=(await db.query('SELECT * FROM custom_field_definitions WHERE user_id=$1',[userId])).rows;
 const seen=new Set(),out=[];
 for(const item of items){
  if(!item||typeof item.id!=='string'||seen.has(item.id))fail('Invalid or duplicate field');seen.add(item.id);
  const d=defs.find(x=>x.id===item.id),old=previous.find(x=>x.id===item.id);
  if(!d||(!old&&d.scope==='edition'&&d.edition!==edition))fail('Field is unavailable',403);
  if(editing&&old&&JSON.stringify(item.value)===JSON.stringify(old.value)){out.push(old);continue;}
  if(editing&&!d.active)fail('Inactive values are preserved and cannot be changed');
  const selected=!editing&&d.versions?.[String(item.revision)]||d;
  // Revision snapshots let an offline draft retain an older name, type and choice.
  if(!editing&&(!Number.isInteger(item.revision)||!d.versions?.[String(item.revision)]))fail('Field revision unavailable');
  const v=value(selected,item.value);
  if(selected.required&&v===null)fail(selected.name+' is required',422);
  if(v!==null)out.push({id:d.id,name:selected.name,type:selected.type,value:v,revision:editing?d.revision:item.revision});
 }
 if(editing){for(const old of previous)if(!seen.has(old.id))out.push(old);}
 // Only the definitions seen by a draft are required. Later definitions do not block queued uploads.
 return out;
}
function filter(where,vals,query){
 if(!query.custom_field||query.custom_value===undefined)return;
 if(!/^[0-9a-f-]{36}$/i.test(query.custom_field)||String(query.custom_value).length>250)fail('Invalid custom field filter');
 vals.push(query.custom_field,String(query.custom_value));
 where.push(`EXISTS(SELECT 1 FROM jsonb_array_elements(c.custom_fields) cf WHERE cf->>'id'=$${vals.length-1} AND cf->>'value'=$${vals.length})`);
}
function lines(c){return (c.custom_fields||[]).map(f=>`${f.name}: ${f.type==='boolean'?(f.value?'Yes':'No'):f.value}`).join('\n');}
function register(app,{pool,requireAuth,currentProduct}){
 const gate=async(req,res,next)=>{try{req.cfEdition=normalizeEdition(await currentProduct(req.user.id));if(req.user.plan!=='pro'||!EDITIONS.includes(req.cfEdition))return res.status(403).json({error:'Pro edition required'});next();}catch{res.status(503).json({error:'Account unavailable'});}};
 app.get('/api/custom-fields',requireAuth,gate,async(req,res)=>{try{res.json((await pool.query('SELECT * FROM custom_field_definitions WHERE user_id=$1 ORDER BY updated_at,id',[req.user.id])).rows);}catch{res.status(503).json({error:'Custom Fields unavailable'});}});
 app.put('/api/custom-fields/:id',requireAuth,gate,async(req,res)=>{
  let db;try{
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id))fail('Invalid field ID');
   const d=definition(req.body);
   if(d.scope==='edition'&&d.edition!==req.cfEdition)fail('Select the field edition first',403);
   db=await pool.connect();await db.query('BEGIN');await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[req.user.id]);
   const old=(await db.query('SELECT * FROM custom_field_definitions WHERE id=$1',[req.params.id])).rows[0];
   if(old&&old.user_id!==req.user.id)fail('Field unavailable',404);
   if(old&&(old.type!==d.type||old.scope!==d.scope||old.edition!==d.edition))fail('Type and scope cannot change. Deactivate and create a new field.');
   const count=(await db.query(`SELECT count(*)::int n FROM custom_field_definitions WHERE user_id=$1 AND active=true AND scope=$2 AND edition IS NOT DISTINCT FROM $3 AND id<>$4`,[req.user.id,d.scope,d.edition,req.params.id])).rows[0].n;
   if(d.active&&count>=LIMITS.active)fail('Maximum 12 active fields per scope');
   const revision=(old?.revision||0)+1,versions={...(old?.versions||{}),[revision]:d};
   const row=(await db.query(`INSERT INTO custom_field_definitions(id,user_id,scope,edition,name,type,prompt,required,active,options,revision,versions) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,prompt=EXCLUDED.prompt,required=EXCLUDED.required,active=EXCLUDED.active,options=EXCLUDED.options,revision=EXCLUDED.revision,versions=EXCLUDED.versions,updated_at=now() RETURNING *`,[req.params.id,req.user.id,d.scope,d.edition,d.name,d.type,d.prompt,d.required,d.active,JSON.stringify(d.options),revision,JSON.stringify(versions)])).rows[0];
   await db.query('COMMIT');res.json(row);
  }catch(e){if(db)await db.query('ROLLBACK');res.status(e.status||503).json({error:e.status?e.message:'Field could not be saved'});}finally{db?.release();}
 });
 app.put('/api/captures/:id/custom-fields',requireAuth,gate,async(req,res)=>{
  let db;try{
   db=await pool.connect();await db.query('BEGIN');
   const c=(await db.query('SELECT * FROM captures WHERE id=$1 AND user_id=$2 FOR UPDATE',[req.params.id,req.user.id])).rows[0];if(!c)fail('Photo Note unavailable',404);
   const fields=await captureValues(db,req.user.id,req.cfEdition,req.body.values,{previous:c.custom_fields,editing:true});
   if(JSON.stringify(fields)!==JSON.stringify(c.custom_fields)){
    await db.query('UPDATE captures SET custom_fields=$1 WHERE id=$2',[JSON.stringify(fields),c.id]);
    await db.query(`INSERT INTO capture_history(capture_id,user_id,action,detail) VALUES($1,$2,'custom_fields_updated',$3)`,[c.id,req.user.id,JSON.stringify({fields:[...new Set([...c.custom_fields,...fields].filter(f=>JSON.stringify(fields.find(x=>x.id===f.id))!==JSON.stringify(c.custom_fields.find(x=>x.id===f.id))).map(f=>f.name))],before:c.custom_fields,after:fields})]);
   }
   await db.query('COMMIT');res.json({custom_fields:fields});
  }catch(e){if(db)await db.query('ROLLBACK');res.status(e.status||503).json({error:e.status?e.message:'Additional Details could not be saved'});}finally{db?.release();}
 });
}
module.exports={normalizeEdition,SCHEMA,EDITIONS,TYPES,LIMITS,definition,value,captureValues,filter,lines,register};

'use strict';
const {randomUUID}=require('node:crypto');
const EDITIONS=['general','paving','concrete','property','hoa','contractor','roofer'];
const SCHEMA=`CREATE TABLE IF NOT EXISTS saved_views (
 id UUID PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 edition TEXT NOT NULL, workspace TEXT NOT NULL, name TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '', criteria JSONB NOT NULL,
 is_default BOOLEAN NOT NULL DEFAULT false, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saved_views_owner ON saved_views(user_id,edition,workspace);
CREATE UNIQUE INDEX IF NOT EXISTS saved_views_one_default ON saved_views(user_id,edition,workspace) WHERE is_default;`;
// Versioned, bounded JSON allows future filter adapters without storing photo IDs.
function validate(b){
 if(!b||typeof b.name!=='string'||!b.name.trim()||b.name.length>100||typeof b.description!=='string'||b.description.length>1000||typeof b.is_default!=='boolean')return false;
 const c=b.criteria;
 if(!c||c.version!==1||!c.filters||Array.isArray(c.filters)||typeof c.filters!=='object'||JSON.stringify(c).length>12000)return false;
 if(Object.keys(c).some(k=>!['version','filters'].includes(k))||Object.keys(c.filters).length>40)return false;
 return Object.entries(c.filters).every(([k,v])=>/^[a-z][a-zA-Z0-9_]{0,63}$/.test(k)&&!['__proto__','constructor','prototype','ids','photoIds','captureIds'].includes(k)&&(typeof v==='boolean'||(typeof v==='string'&&v.length<=2000)));
}
function register(app,{pool,requireAuth,currentProduct}){
 const gate=[requireAuth,async(req,res,next)=>{try{req.savedEdition=await currentProduct(req.user.id);if(!EDITIONS.includes(req.savedEdition))return res.status(403).json({error:'Supported Pro edition required'});next();}catch{res.status(503).json({error:'Saved Views unavailable'});}}];
 const context=req=>{const w=req.method==='GET'?req.query.workspace:req.body?.workspace;return w==='organize'||(w==='maintenance'&&['hoa','property'].includes(req.savedEdition))?w:null;};
 app.get('/api/saved-views',...gate,async(req,res)=>{const w=context(req);if(!w)return res.status(400).json({error:'Invalid workspace'});try{res.json((await pool.query('SELECT id,name,description,criteria,is_default FROM saved_views WHERE user_id=$1 AND edition=$2 AND workspace=$3 ORDER BY lower(name),id',[req.user.id,req.savedEdition,w])).rows);}catch{res.status(503).json({error:'Saved Views could not be loaded'});}});
 app.post('/api/saved-views',...gate,save);
 app.put('/api/saved-views/:id',...gate,save);
 async function save(req,res){
  const w=context(req),id=req.params.id||randomUUID();
  if(!w||!validate(req.body)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))return res.status(400).json({error:'Valid name and criteria required'});
  let db;try{db=await pool.connect();await db.query('BEGIN');
   // Serialize all mutations for an owner, including the single-default transition.
   await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[req.user.id]);
   if(req.params.id){const owned=await db.query('SELECT id FROM saved_views WHERE id=$1 AND user_id=$2 AND edition=$3 AND workspace=$4 FOR UPDATE',[id,req.user.id,req.savedEdition,w]);if(!owned.rows.length){await db.query('ROLLBACK');return res.status(404).json({error:'Saved View unavailable'});}}
   if(req.body.is_default)await db.query('UPDATE saved_views SET is_default=false WHERE user_id=$1 AND edition=$2 AND workspace=$3',[req.user.id,req.savedEdition,w]);
   const values=[req.user.id,req.savedEdition,w,req.body.name.trim(),req.body.description,JSON.stringify(req.body.criteria),req.body.is_default,id];
   const sql=req.params.id?'UPDATE saved_views SET name=$4,description=$5,criteria=$6,is_default=$7,updated_at=now() WHERE user_id=$1 AND edition=$2 AND workspace=$3 AND id=$8 RETURNING id,name,description,criteria,is_default':'INSERT INTO saved_views(user_id,edition,workspace,name,description,criteria,is_default,id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,name,description,criteria,is_default';
   const row=(await db.query(sql,values)).rows[0];await db.query('COMMIT');res.json(row);
  }catch{if(db)await db.query('ROLLBACK').catch(()=>{});res.status(503).json({error:'Saved View could not be saved'});}finally{db?.release();}
 }
 app.delete('/api/saved-views/:id',...gate,async(req,res)=>{const w=context(req);if(!w||!/^[a-f0-9-]{36}$/i.test(req.params.id))return res.status(400).json({error:'Invalid Saved View'});try{const r=await pool.query('DELETE FROM saved_views WHERE id=$1 AND user_id=$2 AND edition=$3 AND workspace=$4 RETURNING id',[req.params.id,req.user.id,req.savedEdition,w]);res.status(r.rows.length?200:404).json({ok:!!r.rows.length});}catch{res.status(503).json({error:'Saved View could not be deleted'});}});
}
module.exports={SCHEMA,validate,register,EDITIONS};

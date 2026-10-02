// Account-owned send preferences shared by every client.
const SCHEMA=`CREATE TABLE IF NOT EXISTS send_shortcuts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  type TEXT NOT NULL CHECK (type IN ('email','sms','website','ramo')),
  target TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('pdf','docx','bundle')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS send_shortcuts_user_idx ON send_shortcuts(user_id);`;
function validateShortcut(body){
  if(!body||typeof body.name!=='string'||typeof body.target!=='string')return null;
  const {type,format}=body,name=body.name.trim(),target=body.target.trim();
  if(!name||name.length>80||target.length>2048||!['pdf','docx','bundle'].includes(format))return null;
  if(type==='email'){if(!/^[^\s@?,&#]+@[^\s@?,&#]+\.[^\s@?,&#]+$/.test(target))return null;}
  else if(type==='sms'){if(!/^\+?[\d ()-]{3,30}$/.test(target)||target.replace(/\D/g,'').length<3)return null;}
  else if(type==='website'){try{const url=new URL(target);if(url.protocol!=='https:'||url.username||url.password)return null;}catch{return null;}}
  else if(type!=='ramo')return null;
  return {name,type,target:type==='ramo'?'':target,format};
}
function ramoShortcutAllowed(user){return user?.plan==='pro'&&user.pro_type==='concrete'&&require('./ramo-intake').allowed(user);}
function registerSendShortcuts(app,{pool,requireAuth,canUseRamo=ramoShortcutAllowed}){
  app.use('/api/send-shortcuts',requireAuth,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
  const guard=(req,res,next)=>req.get('X-Photo-Notes-Shortcuts')==='1'?next():res.status(403).json({error:'Use Photo Notes to update shortcuts.'});
  app.get('/api/send-shortcuts',async(req,res)=>{try{res.json((await pool.query('SELECT id,name,type,target,format FROM send_shortcuts WHERE user_id=$1 ORDER BY created_at,id',[req.user.id])).rows.filter(row=>row.type!=='ramo'||canUseRamo(req.user)));}catch{res.status(503).json({error:'Shortcuts are unavailable. Please try again.'});}});
  app.post('/api/send-shortcuts',guard,async(req,res)=>{const row=validateShortcut(req.body);if(!row)return res.status(400).json({error:'Enter a name and a valid destination.'});if(row.type==='ramo'&&!canUseRamo(req.user))return res.status(403).json({error:'ramo_access_required'});try{res.status(201).json((await pool.query('INSERT INTO send_shortcuts(user_id,name,type,target,format) VALUES($1,$2,$3,$4,$5) RETURNING id,name,type,target,format',[req.user.id,row.name,row.type,row.target,row.format])).rows[0]);}catch{res.status(503).json({error:'Could not save shortcut. Please try again.'});}});
  app.delete('/api/send-shortcuts/:id',guard,async(req,res)=>{if(!/^\d{1,9}$/.test(req.params.id))return res.status(404).json({error:'Shortcut not found.'});try{const result=await pool.query('DELETE FROM send_shortcuts WHERE id=$1 AND user_id=$2 RETURNING id',[Number(req.params.id),req.user.id]);if(!result.rows.length)return res.status(404).json({error:'Shortcut not found.'});res.json({ok:true});}catch{res.status(503).json({error:'Could not delete shortcut. Please try again.'});}});
}
module.exports={SCHEMA,validateShortcut,registerSendShortcuts,ramoShortcutAllowed};

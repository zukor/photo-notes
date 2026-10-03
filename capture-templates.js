'use strict';
const editions=['pro','paving','concrete','hoa','property','contractor','roofer'];
function sanitize(edition, input={}) {
 const out={};
 if(typeof input.topic==='string'&&input.topic.trim())out.topic=input.topic.trim().slice(0,100);
 if(['standard','urgent'].includes(input.urgency))out.urgency=input.urgency;
 const fields=edition==='concrete'?['concretePhase','concretePurpose','concreteElement']:['hoa','property'].includes(edition)?['hoaType','hoaPriority','hoaArea']:edition==='paving'?['pavingPhotoReason']:[];
 const concrete=require('./public/concrete-capture');
 const choices={hoaType:['maintenance','information','inspection'],hoaPriority:['routine','high','emergency','monitor'],concretePhase:concrete.phases.map(p=>p.id),concreteElement:Object.keys(concrete.elements),concretePurpose:(concrete.phase(input.concretePhase)?.purposes||[]).map(p=>p[0]),pavingPhotoReason:['proposal']};
 for(const key of fields)if(typeof input[key]==='string'&&input[key]&&(!choices[key]||choices[key].includes(input[key])))out[key]=input[key].slice(0,100);
 if(out.pavingPhotoReason&&out.pavingPhotoReason!=='proposal')delete out.pavingPhotoReason;
 return out;
}
function register(app,{pool,requireAuth}) {
 const gate=[requireAuth,(req,res,next)=>req.user.plan==='pro'?next():res.status(403).json({error:'Pro edition required'})];
 app.get('/api/capture-templates',...gate,async(req,res)=>{try{res.json((await pool.query('SELECT id,edition,name,description,defaults,deleted FROM capture_templates WHERE user_id=$1 ORDER BY updated_at',[req.user.id])).rows);}catch{res.status(503).json({error:'Templates unavailable'});}});
 app.put('/api/capture-templates/:id',...gate,async(req,res)=>{const b=req.body||{};
 if(!/^[a-f0-9-]{36}$/i.test(req.params.id)||!editions.includes(b.edition)||typeof b.name!=='string'||!b.name.trim()||b.name.length>100)return res.status(400).json({error:'Valid name and edition required'});
 const allowed=req.user.pro_type==='general'?'pro':req.user.pro_type==='asphalt'?'paving':req.user.pro_type;
 if(allowed!==b.edition)return res.status(403).json({error:'Select the template edition first'});
 try{const r=await pool.query(`INSERT INTO capture_templates(user_id,id,edition,name,description,defaults,deleted) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,defaults=EXCLUDED.defaults,deleted=EXCLUDED.deleted,updated_at=now() WHERE capture_templates.edition=EXCLUDED.edition RETURNING id`,[req.user.id,req.params.id,b.edition,b.name.trim(),String(b.description||'').slice(0,500),JSON.stringify(sanitize(b.edition,b.defaults)),b.deleted===true]);if(!r.rows.length)return res.status(409).json({error:'Template edition cannot change'});res.json({ok:true});}catch{res.status(503).json({error:'Template sync unavailable'});}
 });
}
module.exports={register,sanitize,editions};

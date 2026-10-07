const types=new Set(['datetime','address','gps','copyright','topic','dims','defect','custom','rect','arrow']);
function cleanOverlays(value){
 if(!Array.isArray(value)||!value.length||value.length>20)throw Error('A template needs 1 to 20 markings.');
 return value.map(it=>{if(!it||!types.has(it.t))throw Error('Unsupported marking type.');const number=(key,min,max,fallback)=>{const n=it[key]===undefined?fallback:it[key];if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw Error('Invalid marking position or size.');return n;};
 const out={t:it.t,x:number('x',0,100,4),y:number('y',0,100,4),color:/^#[a-f0-9]{6}$/i.test(it.color||'')?it.color:'#ffffff'};
 if(['rect','arrow'].includes(it.t)){out.w=number('w',.1,100,40);out.h=number('h',.1,100,30);out.thickness=number('thickness',.1,3,.6);if(it.t==='arrow')out.dir=['se','sw','ne','nw'].includes(it.dir)?it.dir:'se';}
 else{out.size=number('size',.5,3,1.25);out.font=['sans','serif','mono','heavy'].includes(it.font)?it.font:'sans';out.outline=it.outline===true;if(it.t==='custom'||(it.t==='copyright'&&it.text!==undefined)){if(typeof it.text!=='string'||it.text.length>2000)throw Error('Custom text must be at most 2,000 characters.');out.text=it.text;}}
 return out;});
}
function registerAnnotationTemplateLibrary(app,{pool,requireAuth}){
 app.get('/api/annotation-templates',requireAuth,async(req,res)=>{try{res.json((await pool.query('SELECT id,name,overlays FROM annotation_templates WHERE user_id=$1 ORDER BY lower(name),id',[req.user.id])).rows);}catch{res.status(500).json({error:'Saved annotation templates could not be loaded.'});}});
 app.post('/api/annotation-templates',requireAuth,async(req,res)=>{let overlays,name;try{name=typeof req.body?.name==='string'?req.body.name.trim():'';if(!name||name.length>80)throw Error('Enter a template name of 1 to 80 characters.');overlays=cleanOverlays(req.body.overlays);}catch(e){return res.status(400).json({error:e.message});}
 try{const row=(await pool.query('INSERT INTO annotation_templates(user_id,name,overlays) VALUES($1,$2,$3::jsonb) RETURNING id,name,overlays',[req.user.id,name,JSON.stringify(overlays)])).rows[0];res.json(row);}catch(e){res.status(e.code==='23505'?409:500).json({error:e.code==='23505'?'That template name already exists. Choose a different name.':'Annotation template could not be saved.'});}});
 app.delete('/api/annotation-templates/:id',requireAuth,async(req,res)=>{const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid template.'});try{const r=await pool.query('DELETE FROM annotation_templates WHERE id=$1 AND user_id=$2',[id,req.user.id]);res.status(r.rowCount?200:404).json(r.rowCount?{ok:true}:{error:'Template not found.'});}catch{res.status(500).json({error:'Annotation template could not be deleted.'});}});
}
module.exports={registerAnnotationTemplateLibrary,cleanOverlays};

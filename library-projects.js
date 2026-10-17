'use strict';
const validId=value=>(typeof value==='number'||(typeof value==='string'&&/^\d+$/.test(value)))&&Number.isSafeInteger(Number(value))&&Number(value)>0&&Number(value)<=2147483647;
async function attach(pool,userId,rows){
 if(!rows.length)return rows;
 const memberships=(await pool.query(`SELECT m.capture_id,j.id,j.name,j.job_number,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) ORDER BY g.name,g.id) FROM project_groups g JOIN project_group_items gi ON gi.group_id=g.id WHERE gi.capture_id=m.capture_id AND g.job_id=j.id AND g.user_id=$1),'[]'::jsonb) groups
 FROM capture_project_memberships m JOIN captures c ON c.id=m.capture_id AND c.user_id=$1 JOIN jobs j ON j.id=m.job_id AND j.user_id=$1 WHERE m.user_id=$1 AND m.capture_id=ANY($2::int[]) ORDER BY j.name,j.id`,[userId,rows.map(row=>row.id)])).rows;
 const byId=new Map(rows.map(row=>[row.id,row]));for(const row of rows)row.project_memberships=[];
 for(const {capture_id,...project} of memberships)byId.get(capture_id)?.project_memberships.push(project);
 return rows;
}
function register(app,{pool,requireAuth}){
 app.post('/api/library/assign',requireAuth,async(req,res)=>{
  const b=req.body||{},raw=b.ids,project=Number(b.project_id),group=b.group_id==null||b.group_id===''?null:Number(b.group_id);
  if(!Array.isArray(raw)||!raw.length||raw.length>500||!raw.every(validId)||!validId(b.project_id)||(group!==null&&!validId(b.group_id)))return res.status(400).json({error:'Choose valid PhotoNotes and project'});
  const ids=[...new Set(raw.map(Number))].sort((a,b)=>a-b);let db;
  try{db=await pool.connect();await db.query('BEGIN');
   if(!(await db.query('SELECT id FROM jobs WHERE id=$1 AND user_id=$2 FOR KEY SHARE',[project,req.user.id])).rowCount){await db.query('ROLLBACK').catch(()=>{});return res.status(403).json({error:'Project is unavailable to this account'});}
   if(group!==null&&!(await db.query('SELECT id FROM project_groups WHERE id=$1 AND job_id=$2 AND user_id=$3 FOR KEY SHARE',[group,project,req.user.id])).rowCount){await db.query('ROLLBACK').catch(()=>{});return res.status(403).json({error:'Choose a group in this project'});}
   const owned=await db.query('SELECT id FROM captures WHERE user_id=$1 AND id=ANY($2::int[]) ORDER BY id FOR UPDATE',[req.user.id,ids]);
   if(owned.rowCount!==ids.length){await db.query('ROLLBACK').catch(()=>{});return res.status(403).json({error:'One or more PhotoNotes are unavailable to this account'});}
   // Preserve existing primary project links and any older memberships.
   await db.query('INSERT INTO capture_project_memberships(user_id,capture_id,job_id) SELECT user_id,id,job_id FROM captures WHERE user_id=$1 AND id=ANY($2::int[]) AND job_id IS NOT NULL ON CONFLICT DO NOTHING',[req.user.id,ids]);
   await db.query('INSERT INTO capture_project_memberships(user_id,capture_id,job_id) SELECT $1,unnest($2::int[]),$3 ON CONFLICT DO NOTHING',[req.user.id,ids,project]);
   if(group!==null)await db.query('INSERT INTO project_group_items(group_id,capture_id) SELECT $1,unnest($2::int[]) ON CONFLICT DO NOTHING',[group,ids]);
   await db.query('UPDATE captures SET job_id=$3 WHERE user_id=$1 AND id=ANY($2::int[]) AND job_id IS NULL',[req.user.id,ids,project]);
   await db.query("INSERT INTO capture_history(capture_id,user_id,action,detail) SELECT unnest($1::int[]),$2,'details_updated',$3::jsonb",[ids,req.user.id,JSON.stringify({fields:['project_membership'],project_id:project,group_id:group})]);
   await db.query('COMMIT');res.json({ok:true,updated:ids.length});
  }catch(error){if(db)await db.query('ROLLBACK').catch(()=>{});console.error('[library.assign]',error.message);res.status(500).json({error:'PhotoNotes could not be added to the project'});}finally{db?.release();}
 });
 app.get('/api/projects/:id/groups',requireAuth,async(req,res)=>{
  const id=Number(req.params.id);if(!validId(id))return res.status(400).json({error:'Invalid project'});
  try{if(!(await pool.query('SELECT id FROM jobs WHERE id=$1 AND user_id=$2',[id,req.user.id])).rowCount)return res.status(403).json({error:'Project is unavailable to this account'});
   const rows=(await pool.query('SELECT g.id,g.name,COUNT(c.id)::int photo_count FROM project_groups g LEFT JOIN project_group_items gi ON gi.group_id=g.id LEFT JOIN captures c ON c.id=gi.capture_id AND c.user_id=$2 WHERE g.job_id=$1 AND g.user_id=$2 GROUP BY g.id ORDER BY g.name,g.id',[id,req.user.id])).rows;res.json(rows);
  }catch(error){console.error('[library.groups]',error.message);res.status(500).json({error:'Project groups could not be loaded'});}
 });
 app.post('/api/projects/:id/groups',requireAuth,async(req,res)=>{
  const id=Number(req.params.id),name=typeof req.body?.name==='string'?req.body.name.trim():'';if(!validId(id)||!name||name.length>200)return res.status(400).json({error:'Enter a group name of up to 200 characters'});
  try{const row=(await pool.query('INSERT INTO project_groups(user_id,job_id,name) SELECT $1,id,$3 FROM jobs WHERE id=$2 AND user_id=$1 ON CONFLICT(user_id,job_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id,name',[req.user.id,id,name])).rows[0];if(!row)return res.status(403).json({error:'Project is unavailable to this account'});res.json(row);
  }catch(error){console.error('[library.groups.create]',error.message);res.status(500).json({error:'Project group could not be created'});}
 });
}
module.exports={attach,register};

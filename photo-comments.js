'use strict';
const EDITIONS=new Set(['general','paving','concrete','property','hoa','contractor','roofer']);
const SCHEMA=`CREATE TABLE IF NOT EXISTS photo_comments (
 id SERIAL PRIMARY KEY,capture_id INTEGER NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
 author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,author_name TEXT NOT NULL,
 text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 4000),
 reply_to INTEGER REFERENCES photo_comments(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 edited_at TIMESTAMPTZ,deleted_at TIMESTAMPTZ,deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL);
 CREATE INDEX IF NOT EXISTS photo_comments_capture_idx ON photo_comments(capture_id,created_at,id);
 CREATE TABLE IF NOT EXISTS photo_comment_history (
 id SERIAL PRIMARY KEY,comment_id INTEGER NOT NULL REFERENCES photo_comments(id) ON DELETE CASCADE,
 actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,previous_text TEXT NOT NULL,action TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now());
 ALTER TABLE hoa_notifications ADD COLUMN IF NOT EXISTS capture_id INTEGER REFERENCES captures(id) ON DELETE CASCADE;`;
// Only existing company record relationships confer team access. Mere owner membership does not.
const CONTEXT=`SELECT i.company_id,i.id item_id,c.name context FROM hoa_item_photos p JOIN hoa_maintenance_items i ON i.id=p.item_id JOIN hoa_communities c ON c.id=i.community_id WHERE p.capture_id=$1
 UNION SELECT a.company_id,NULL,c.name||' / '||a.name FROM hoa_asset_photos p JOIN hoa_assets a ON a.id=p.asset_id JOIN hoa_communities c ON c.id=a.community_id WHERE p.capture_id=$1
 UNION SELECT v.company_id,NULL,c.name||' / '||s.name FROM hoa_visit_stops s JOIN hoa_property_visits v ON v.id=s.visit_id JOIN hoa_communities c ON c.id=v.community_id WHERE $1=ANY(s.capture_ids)`;
const valid=id=>Number.isSafeInteger(id)&&id>0&&id<=2147483647;
async function access(db,id,user,edition){
 const capture=(await db.query('SELECT id,user_id,photo_path,photo_title,created_at,job_id,address FROM captures WHERE id=$1 AND photo_path IS NOT NULL',[id])).rows[0];
 if(!capture)return null;
 const contexts=['hoa','property'].includes(edition)?(await db.query(CONTEXT,[id])).rows:[];
 const memberships=contexts.length?(await db.query('SELECT company_id,company_role FROM hoa_company_members WHERE user_id=$1 AND company_id=ANY($2::int[])',[user.id,contexts.map(c=>c.company_id)])).rows:[];
 if(capture.user_id!==user.id&&!memberships.length)return null;
 const allowed=contexts.filter(c=>memberships.some(m=>m.company_id===c.company_id));
 let job=null;if(capture.job_id&&capture.user_id===user.id)job=(await db.query('SELECT name FROM jobs WHERE id=$1 AND user_id=$2',[capture.job_id,user.id])).rows[0]?.name;
 return {capture,contexts:allowed,context:allowed.map(c=>c.context).join(', ')||job||capture.address||'',moderate:memberships.some(m=>m.company_role==='administrator')};
}
async function recipients(db,a,actor){
 if(!a.contexts.length)return [];
 return (await db.query(`SELECT DISTINCT u.id,u.name FROM hoa_company_members m JOIN users u ON u.id=m.user_id WHERE m.company_id=ANY($1::int[]) AND u.active=true AND u.plan='pro' AND u.pro_type IN ('hoa','property') AND u.id<>$2`,[a.contexts.map(c=>c.company_id),actor])).rows;
}
function register(app,{pool,requireAuth,currentProduct}){
 const guard=async(req,res,next)=>{res.setHeader('Cache-Control','no-store');try{const edition=await currentProduct(req.user.id);if(!EDITIONS.has(edition))return res.status(403).json({error:'Comments requires an enabled Pro edition'});const id=Number(req.params.id);if(!valid(id))return res.status(400).json({error:'Invalid photo ID'});req.commentEdition=edition;req.commentCapture=id;next();}catch(e){res.status(503).json({error:'Comments unavailable. Your draft has not been saved.'});}};
 app.get('/api/captures/:id/comments',requireAuth,guard,async(req,res)=>{try{const a=await access(pool,req.commentCapture,req.user,req.commentEdition);if(!a)return res.status(404).json({error:'Photo not found'});const comments=(await pool.query(`SELECT id,author_id,author_name,CASE WHEN deleted_at IS NULL THEN text ELSE '' END text,reply_to,created_at,edited_at,deleted_at FROM photo_comments WHERE capture_id=$1 ORDER BY created_at,id`,[req.commentCapture])).rows;res.json({capture:a.capture,context:a.context,comments:comments.map(c=>({...c,can_edit:!c.deleted_at&&c.author_id===req.user.id,can_delete:!c.deleted_at&&(c.author_id===req.user.id||a.moderate)})),members:await recipients(pool,a,req.user.id)});}catch(e){res.status(503).json({error:'Comments could not load. Retry when connected.'});}});
 for(const method of ['post','patch','delete'])app[method]('/api/captures/:id/comments'+(method==='post'?'':'/:commentId'),requireAuth,guard,async(req,res)=>{
 let db;try{
 const text=req.body?.text,reply=req.body?.reply_to;
 if(method!=='delete'&&(typeof text!=='string'||!text.trim()||text.length>4000))return res.status(400).json({error:'Enter a comment up to 4000 characters'});
 if(method==='post'&&reply!=null&&!valid(reply))return res.status(400).json({error:'Invalid reply'});
 const cid=Number(req.params.commentId);if(method!=='post'&&!valid(cid))return res.status(400).json({error:'Invalid comment ID'});
 db=await pool.connect();await db.query('BEGIN');
 await db.query('SELECT id FROM captures WHERE id=$1 FOR UPDATE',[req.commentCapture]);
 const a=await access(db,req.commentCapture,req.user,req.commentEdition);if(!a){await db.query('ROLLBACK');return res.status(404).json({error:'Photo not found'});}
 let comment;
 if(method==='post'){
 let parent=null;if(reply!=null){parent=(await db.query('SELECT id,reply_to FROM photo_comments WHERE id=$1 AND capture_id=$2 AND deleted_at IS NULL',[reply,req.commentCapture])).rows[0];if(!parent){await db.query('ROLLBACK');return res.status(400).json({error:'Reply comment unavailable'});}}
 comment=(await db.query('INSERT INTO photo_comments(capture_id,author_id,author_name,text,reply_to) VALUES($1,$2,$3,$4,$5) RETURNING id',[req.commentCapture,req.user.id,req.user.name||'Team member',text.trim(),parent?(parent.reply_to||parent.id):null])).rows[0];
 for(const member of await recipients(db,a,req.user.id)){
 const mentioned=!!member.name&&text.toLowerCase().includes('@'+member.name.toLowerCase());
 await db.query('INSERT INTO hoa_notifications(user_id,item_id,capture_id,message) VALUES($1,$2,$3,$4)',[member.id,a.contexts.find(c=>c.item_id)?.item_id||null,req.commentCapture,mentioned?'You were mentioned in a Photo Note comment.':`${req.user.name||'A team member'} commented on a Photo Note.`]);}
 }else{
 comment=(await db.query('SELECT * FROM photo_comments WHERE id=$1 AND capture_id=$2 FOR UPDATE',[cid,req.commentCapture])).rows[0];
 if(!comment||comment.deleted_at){await db.query('ROLLBACK');return res.status(404).json({error:'Comment not found'});}
 if(comment.author_id!==req.user.id&&!(method==='delete'&&a.moderate)){await db.query('ROLLBACK');return res.status(403).json({error:'You can only change your own comments'});}
 await db.query('INSERT INTO photo_comment_history(comment_id,actor_id,previous_text,action) VALUES($1,$2,$3,$4)',[cid,req.user.id,comment.text,method]);
 if(method==='patch'){
 await db.query('UPDATE photo_comments SET text=$1,edited_at=now() WHERE id=$2',[text.trim(),cid]);
 for(const member of await recipients(db,a,req.user.id))if(member.name&&text.toLowerCase().includes('@'+member.name.toLowerCase())&&!comment.text.toLowerCase().includes('@'+member.name.toLowerCase()))
 await db.query('INSERT INTO hoa_notifications(user_id,item_id,capture_id,message) VALUES($1,$2,$3,$4)',[member.id,a.contexts.find(c=>c.item_id)?.item_id||null,req.commentCapture,'You were mentioned in a Photo Note comment.']);
 }else await db.query('UPDATE photo_comments SET deleted_at=now(),deleted_by=$1 WHERE id=$2',[req.user.id,cid]);
 }
 await db.query('COMMIT');res.status(method==='post'?201:200).json({ok:true,id:comment.id});
 }catch(e){if(db)await db.query('ROLLBACK');console.error('[photo-comments]',e.message);res.status(503).json({error:'Comment could not save. Keep your draft and retry when connected.'});}finally{db?.release();}
 });
}
module.exports={EDITIONS,SCHEMA,CONTEXT,access,recipients,valid,register};

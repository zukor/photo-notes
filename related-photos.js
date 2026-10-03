'use strict';
const TYPES=['Related Condition','Same Subject','Nearby Condition','Cause / Source','Result / Effect','Supporting Evidence','Other'];
const EDITIONS=new Set(['general','paving','asphalt','concrete','property','hoa','contractor','roofer']);
const SCHEMA=`CREATE TABLE IF NOT EXISTS related_photos (
 id SERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 photo_a INTEGER NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
 photo_b INTEGER NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
 relationship_type TEXT, note TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(photo_a<photo_b),UNIQUE(photo_a,photo_b));
 CREATE INDEX IF NOT EXISTS related_photos_user_a ON related_photos(user_id,photo_a);
 CREATE INDEX IF NOT EXISTS related_photos_user_b ON related_photos(user_id,photo_b);`;
function register(app,{pool,requireAuth,currentProduct}){
 const gate=async(req,res,next)=>{if(!EDITIONS.has(await currentProduct(req.user.id)))return res.status(403).json({error:'Related Photos requires Pro'});next();};
 const valid=id=>Number.isSafeInteger(id)&&id>0;
 app.get('/api/related-photos/candidates',requireAuth,gate,async(req,res)=>{try{const offset=Math.max(0,parseInt(req.query.offset,10)||0),q=String(req.query.q||'').slice(0,200);res.json((await pool.query(`SELECT id,photo_path,photo_title,note,created_at FROM captures WHERE user_id=$1 AND photo_path IS NOT NULL AND (COALESCE(photo_title,'') ILIKE $2 OR COALESCE(note,'') ILIKE $2 OR id::text=$3) ORDER BY created_at DESC,id DESC LIMIT 100 OFFSET $4`,[req.user.id,'%'+q+'%',q,offset])).rows);}catch(e){res.status(500).json({error:'Photos could not load'});}});
 app.get('/api/related-photos/counts',requireAuth,gate,async(req,res)=>{try{res.json((await pool.query(`SELECT photo_id,COUNT(*)::int count FROM (SELECT photo_a photo_id FROM related_photos WHERE user_id=$1 UNION ALL SELECT photo_b FROM related_photos WHERE user_id=$1) r GROUP BY photo_id`,[req.user.id])).rows);}catch(e){res.status(500).json({error:'Relationships could not load'});}});
 app.get('/api/captures/:id/related',requireAuth,gate,async(req,res)=>{try{const id=Number(req.params.id);if(!valid(id))return res.status(400).json({error:'Invalid photo ID'});const capture=(await pool.query('SELECT * FROM captures WHERE id=$1 AND user_id=$2 AND photo_path IS NOT NULL',[id,req.user.id])).rows[0];if(!capture)return res.status(404).json({error:'Photo not found'});const rows=(await pool.query(`SELECT r.id relationship_id,r.relationship_type,r.note relationship_note,c.* FROM related_photos r JOIN captures c ON c.id=CASE WHEN r.photo_a=$1 THEN r.photo_b ELSE r.photo_a END WHERE r.user_id=$2 AND c.user_id=$2 AND (r.photo_a=$1 OR r.photo_b=$1) ORDER BY r.created_at,r.id`,[id,req.user.id])).rows;res.json({capture,photos:rows,types:TYPES});}catch(e){res.status(500).json({error:'Relationships could not load'});}});
 app.post('/api/captures/:id/related',requireAuth,gate,async(req,res)=>{
 let db;try{const id=Number(req.params.id),b=req.body||{},ids=Array.isArray(b.ids)?[...new Set(b.ids)]:[];
 if(!valid(id)||!ids.length||ids.some(x=>!valid(x)||x===id)||!(b.type==null||b.type===''||TYPES.includes(b.type))||typeof b.note!=='string'||b.note.length>2000)return res.status(400).json({error:'Select existing photos, an optional valid type, and a note up to 2000 characters'});
 db=await pool.connect();await db.query('BEGIN');const all=[id,...ids].sort((a,b)=>a-b),owned=(await db.query('SELECT id FROM captures WHERE user_id=$1 AND id=ANY($2::int[]) AND photo_path IS NOT NULL ORDER BY id FOR UPDATE',[req.user.id,all])).rows;if(owned.length!==all.length){await db.query('ROLLBACK');return res.status(404).json({error:'Photo not found'});}
 for(const target of ids){const pair=[id,target].sort((a,b)=>a-b),old=(await db.query('SELECT * FROM related_photos WHERE photo_a=$1 AND photo_b=$2',pair)).rows[0],type=b.type||null,note=b.note.trim();if(old&&old.relationship_type===type&&old.note===note)continue;
 await db.query(`INSERT INTO related_photos(user_id,photo_a,photo_b,relationship_type,note) VALUES($1,$2,$3,$4,$5) ON CONFLICT(photo_a,photo_b) DO UPDATE SET relationship_type=EXCLUDED.relationship_type,note=EXCLUDED.note,updated_at=now()`,[req.user.id,...pair,type,note]);
 for(const photo of pair)await db.query('INSERT INTO capture_history(capture_id,user_id,action,detail) VALUES($1,$2,$3,$4)',[photo,req.user.id,old?'photo_relationship_changed':'photo_linked',JSON.stringify({related_photo_id:photo===id?target:id,relationship_type:type})]);}
 await db.query('COMMIT');res.json({ok:true});
 }catch(e){if(db)await db.query('ROLLBACK');res.status(500).json({error:'Relationships could not save'});}finally{db?.release();}});
 app.delete('/api/captures/:id/related/:target',requireAuth,gate,async(req,res)=>{let db;try{const pair=[Number(req.params.id),Number(req.params.target)].sort((a,b)=>a-b);if(pair.some(x=>!valid(x))||pair[0]===pair[1])return res.status(400).json({error:'Invalid photo IDs'});db=await pool.connect();await db.query('BEGIN');await db.query('SELECT id FROM captures WHERE id=ANY($1::int[]) AND user_id=$2 ORDER BY id FOR UPDATE',[pair,req.user.id]);const removed=(await db.query('DELETE FROM related_photos WHERE photo_a=$1 AND photo_b=$2 AND user_id=$3 RETURNING id',[...pair,req.user.id])).rows;if(removed.length)for(const photo of pair)await db.query(`INSERT INTO capture_history(capture_id,user_id,action,detail) VALUES($1,$2,'photo_unlinked',$3)`,[photo,req.user.id,JSON.stringify({related_photo_id:pair.find(x=>x!==photo)})]);await db.query('COMMIT');res.json({ok:true});}catch(e){if(db)await db.query('ROLLBACK');res.status(500).json({error:'Relationship could not remove'});}finally{db?.release();}});
}
module.exports={TYPES,EDITIONS,SCHEMA,register};

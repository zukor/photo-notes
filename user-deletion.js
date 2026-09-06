const fs=require('fs/promises'),path=require('path');
const FILE_SOURCES=[
 ['captures','photo_path'],['captures','photo_original_path'],['ewr_photos','photo_path'],
 ['asphalt_tickets','photo_path'],['camera_readings','photo_path'],['road_issue_reports','photo_path'],
 ['issue_reports','screenshot_path'],['issue_reports','voice_path'],
 ['users','document_logo_path'],['users','word_template_path']
];
function uploadFile(root,value){
  if(typeof value!=='string'||!/^\/uploads\/[^/\\]+$/.test(value))return null;
  const base=path.resolve(root),file=path.resolve(base,value.slice('/uploads/'.length));
  return file.startsWith(base+path.sep)?file:null;
}
async function deletionPreview(db,id,actorId){
  const user=(await db.query('SELECT id,name,email,role,active FROM users WHERE id=$1',[id])).rows[0];
  if(!user)return null;
  const counts=(await db.query(`SELECT
    (SELECT count(*)::int FROM captures WHERE user_id=$1) AS photos,
    (SELECT count(*)::int FROM groups WHERE user_id=$1) AS documents,
    (SELECT count(*)::int FROM issue_reports WHERE user_id=$1) AS issue_reports,
    (SELECT count(*)::int FROM testing_assignments WHERE user_id=$1) AS assignments`,[id])).rows[0];
  const shared=(await db.query(`SELECT
    (SELECT count(*) FROM hoa_maintenance_items WHERE created_by=$1)+
    (SELECT count(*) FROM hoa_property_visits WHERE created_by=$1)+
    (SELECT count(*) FROM hoa_completion_photo_requests WHERE created_by=$1)+
    (SELECT count(*) FROM hoa_company_members m WHERE user_id=$1 AND NOT EXISTS
      (SELECT 1 FROM hoa_company_members other WHERE other.company_id=m.company_id AND other.user_id<>$1))+
    (SELECT count(*) FROM captures c WHERE c.user_id=$1 AND (
      EXISTS(SELECT 1 FROM hoa_item_photos WHERE capture_id=c.id) OR
      EXISTS(SELECT 1 FROM hoa_asset_photos WHERE capture_id=c.id) OR
      EXISTS(SELECT 1 FROM hoa_assets WHERE primary_capture_id=c.id) OR
      EXISTS(SELECT 1 FROM hoa_maintenance_items WHERE capture_id=c.id) OR
      EXISTS(SELECT 1 FROM hoa_visit_stops WHERE c.id=ANY(capture_ids)) OR
      EXISTS(SELECT 1 FROM group_items gi JOIN groups g ON g.id=gi.group_id WHERE gi.capture_id=c.id AND g.user_id<>$1)
    )) AS count`,[id])).rows[0];
  let blocked=id===actorId?'You cannot delete the account you are currently signed in with.':null;
  if(!blocked&&Number(shared.count)>0)blocked='Shared HOA or document records still depend on this user. Transfer those records and company responsibilities before deleting the account.';
  if(!blocked&&user.role==='admin'){
    const {rows}=await db.query("SELECT count(*)::int AS count FROM users WHERE role='admin' AND active=true AND id<>$1",[id]);
    if(!rows[0].count)blocked='Keep at least one active administrator.';
  }
  return {user,counts,blocked};
}
function registerUserDeletion(app,{pool,requireAdmin,uploadDir}){
  let cleaning=false;
  async function cleanupPendingFiles(){
    if(cleaning)return;cleaning=true;
    try{
      const {rows}=await pool.query('SELECT file_path FROM pending_user_file_deletions ORDER BY created_at LIMIT 100');
      for(const {file_path} of rows){
        const file=uploadFile(uploadDir,file_path);
        if(!file)continue;
        const refs=FILE_SOURCES.map(([table,col])=>`SELECT 1 FROM ${table} WHERE ${col}=$1`).join(' UNION ALL ');
        const referenced=(await pool.query(`SELECT EXISTS(${refs}) AS used`,[file_path])).rows[0].used;
        if(!referenced){try{await fs.unlink(file);}catch(e){if(e.code!=='ENOENT')continue;}}
        await pool.query('DELETE FROM pending_user_file_deletions WHERE file_path=$1',[file_path]);
      }
    }finally{cleaning=false;}
  }
  app.get('/api/admin/users/:id/deletion',requireAdmin,async(req,res)=>{
    const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({error:'Invalid user'});
    try{const preview=await deletionPreview(pool,id,req.user.id);if(!preview)return res.status(404).json({error:'User not found'});res.json(preview);}
    catch(e){res.status(500).json({error:'Could not check user deletion'});}
  });
  app.delete('/api/admin/users/:id',requireAdmin,async(req,res)=>{
    const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({error:'Invalid user'});
    let client,committed=false;
    try{
      client=await pool.connect();await client.query('BEGIN');
      // Serialize account deletions and lock the target before inspecting dependencies.
      await client.query('SELECT pg_advisory_xact_lock(731094)');
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[id]);
      const preview=await deletionPreview(client,id,req.user.id);
      if(!preview){await client.query('ROLLBACK');return res.status(404).json({error:'User not found'});}
      if(preview.blocked){await client.query('ROLLBACK');return res.status(409).json({error:preview.blocked});}
      if(!req.body||req.body.confirm_email!==preview.user.email){await client.query('ROLLBACK');return res.status(400).json({error:'Type the exact email address to confirm permanent deletion'});}
      // Lock owned records so their attachment paths cannot change while collected.
      for(const table of ['captures','groups','ewr_photos','asphalt_tickets','camera_readings','road_issue_reports','issue_reports']){
        await client.query(`SELECT id FROM ${table} WHERE user_id=$1 FOR UPDATE`,[id]);
      }
      // Recheck shared references after locking the records they can reference.
      const lockedPreview=await deletionPreview(client,id,req.user.id);
      if(lockedPreview.blocked){await client.query('ROLLBACK');return res.status(409).json({error:lockedPreview.blocked});}
      const files=(await client.query(FILE_SOURCES.map(([table,col])=>`SELECT ${col} AS file_path FROM ${table} WHERE ${table==='users'?'id':'user_id'}=$1 AND ${col} IS NOT NULL`).join(' UNION '),[id])).rows;
      for(const {file_path} of files){
        if(!uploadFile(uploadDir,file_path))throw new Error('Invalid stored attachment path');
        await client.query('INSERT INTO pending_user_file_deletions(file_path) VALUES($1) ON CONFLICT DO NOTHING',[file_path]);
      }
      // Prevent seeded assignments from recreating a deleted tester on restart.
      await client.query('INSERT INTO retired_testing_assignment_keys(assignment_key) SELECT assignment_key FROM testing_assignments WHERE user_id=$1 ON CONFLICT DO NOTHING',[id]);
      await client.query('DELETE FROM testing_assignments WHERE user_id=$1',[id]);
      await client.query('DELETE FROM groups WHERE user_id=$1',[id]);
      await client.query('DELETE FROM captures WHERE user_id=$1',[id]);
      await client.query('DELETE FROM users WHERE id=$1',[id]);
      await client.query("INSERT INTO events(user_id,action,detail) VALUES($1,'admin_user_delete',$2::jsonb)",[req.user.id,JSON.stringify({target_user_id:id})]);
      await client.query('COMMIT');committed=true;
      // Files are removed only after the account deletion commits. Failures stay
      // in the durable queue and are retried after restarts.
      let file_cleanup_pending=true;
      try{
        await cleanupPendingFiles();
        const pending=await pool.query('SELECT count(*)::int AS count FROM pending_user_file_deletions WHERE file_path=ANY($1::text[])',[files.map(f=>f.file_path)]);
        file_cleanup_pending=pending.rows[0].count>0;
      }catch(e){}
      res.json({ok:true,deleted_id:id,file_cleanup_pending});
    }catch(e){
      if(client&&!committed)await client.query('ROLLBACK');
      res.status(500).json({error:'User could not be deleted. No account changes were committed.'});
    }finally{if(client)client.release();}
  });
  return cleanupPendingFiles;
}
module.exports={registerUserDeletion,deletionPreview,uploadFile};

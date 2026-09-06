const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {registerUserDeletion,uploadFile}=require('../user-deletion');
test('deletion accepts only flat upload paths inside the upload directory',()=>{
  assert.equal(uploadFile('/tmp/uploads','/uploads/photo.jpg'),'/tmp/uploads/photo.jpg');
  for(const value of [null,'/etc/passwd','/uploads/../secret','/uploads/..','/uploads/a/b','/uploads/a\\b'])assert.equal(uploadFile('/tmp/uploads',value),null);
});
test('deletion endpoints require admin authorization and reject invalid IDs before database access',async()=>{
  const routes=[],admin=()=>{};
  registerUserDeletion({get:(...args)=>routes.push(args),delete:(...args)=>routes.push(args)},{pool:{},requireAdmin:admin,uploadDir:'/tmp/uploads'});
  for(const route of routes){assert.equal(route[1],admin);const res={status(c){this.code=c;return this},json(v){this.body=v}};await route[2]({params:{id:'bad'}},res);assert.equal(res.code,400);}
});
// Explicit opt-in only: use an isolated local database named pn_deletion_test.
const url=process.env.USER_DELETION_TEST_DATABASE_URL;
test('permanent deletion with real PostgreSQL constraints and files',{skip:!url},async(t)=>{
  const target=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(target.hostname));assert.equal(target.pathname,'/pn_deletion_test');
  process.env.DATABASE_URL=url;process.env.PGSSL='';process.env.ADMIN_EMAIL='admin@example.test';delete process.env.ADMIN_PASSWORD_RESET;
  const {pool,init}=require('../db');const root=await fs.mkdtemp(path.join(os.tmpdir(),'pn-delete-files-'));
  t.after(async()=>{await pool.end();await fs.rm(root,{recursive:true,force:true});});
  await init();
  const actor=(await pool.query("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1")).rows[0].id;
  const routes={};const cleanup=registerUserDeletion({get:(p,...h)=>routes.get=h.at(-1),delete:(p,...h)=>routes.delete=h.at(-1)},{pool,requireAdmin:()=>{},uploadDir:root});
  const makeUser=async(email,role='user')=>(await pool.query("INSERT INTO users(email,name,password_hash,role) VALUES($1,'Fictional Test','unused',$2) RETURNING id",[email,role])).rows[0].id;
  const call=async(method,id,confirm_email)=>{const res={code:200,status(c){this.code=c;return this},json(v){this.body=v;return this}};await routes[method]({params:{id:String(id)},user:{id:actor},body:{confirm_email}},res);return res;};
  const exists=async(id)=>(await pool.query('SELECT id FROM users WHERE id=$1',[id])).rowCount===1;
  await t.test('self deletion is refused',async()=>{assert.equal((await call('delete',actor,'admin@example.test')).code,409);assert.ok(await exists(actor));});
  await t.test('unknown account is not found',async()=>assert.equal((await call('delete',2147483647,'none@example.test')).code,404));
  const id=await makeUser('remove@example.test'),other=await makeUser('keep@example.test');
  await t.test('exact email is required',async()=>{assert.equal((await call('delete',id,'wrong@example.test')).code,400);assert.ok(await exists(id));});
  const capture=(await pool.query("INSERT INTO captures(user_id,photo_path) VALUES($1,'/uploads/private.jpg') RETURNING id",[id])).rows[0].id;
  const group=(await pool.query("INSERT INTO groups(user_id,title) VALUES($1,'Shared document') RETURNING id",[other])).rows[0].id;
  await pool.query('INSERT INTO group_items(group_id,capture_id) VALUES($1,$2)',[group,capture]);
  await t.test('another user’s shared document blocks deletion',async()=>{const r=await call('delete',id,'remove@example.test');assert.equal(r.code,409);assert.match(r.body.error,/Shared/);assert.ok(await exists(id));});
  await pool.query('DELETE FROM group_items WHERE group_id=$1',[group]);
  await pool.query("INSERT INTO captures(user_id,photo_path) VALUES($1,'/uploads/shared.jpg'),($2,'/uploads/shared.jpg')",[id,other]);
  await pool.query("INSERT INTO groups(user_id,title) VALUES($1,'Private document')",[id]);
  await pool.query("INSERT INTO jobs(user_id,name) VALUES($1,'Private job')",[id]);
  await pool.query("INSERT INTO testing_assignments(assignment_key,assignee_name,user_id,title) VALUES('fictional-deletion-test','Fictional Test',$1,'Test')",[id]);
  await fs.writeFile(path.join(root,'private.jpg'),'private');await fs.writeFile(path.join(root,'shared.jpg'),'shared');
  await t.test('database failure rolls back account and queued files',async()=>{
    await pool.query("CREATE FUNCTION fail_test_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$");
    await pool.query('CREATE TRIGGER fail_test_delete BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION fail_test_delete()');
    const r=await call('delete',id,'remove@example.test');assert.equal(r.code,500);assert.ok(await exists(id));assert.equal((await pool.query('SELECT * FROM pending_user_file_deletions')).rowCount,0);await fs.access(path.join(root,'private.jpg'));
    await pool.query('DROP TRIGGER fail_test_delete ON users');await pool.query('DROP FUNCTION fail_test_delete()');
  });
  await t.test('confirmed deletion removes owned records and private files while preserving others',async()=>{
    const r=await call('delete',id,'remove@example.test');assert.equal(r.code,200,JSON.stringify(r.body));assert.equal(r.body.file_cleanup_pending,false);assert.equal(await exists(id),false);assert.ok(await exists(other));
    for(const table of ['captures','groups','jobs','testing_assignments'])assert.equal((await pool.query(`SELECT 1 FROM ${table} WHERE user_id=$1`,[id])).rowCount,0);
    await assert.rejects(fs.access(path.join(root,'private.jpg')));await fs.access(path.join(root,'shared.jpg'));
    assert.equal((await pool.query("SELECT 1 FROM retired_testing_assignment_keys WHERE assignment_key='fictional-deletion-test'")).rowCount,1);
    assert.equal((await pool.query("SELECT 1 FROM events WHERE user_id=$1 AND action='admin_user_delete'",[actor])).rowCount,1);
  });
  await t.test('missing queued files are safely cleared on retry',async()=>{await pool.query("INSERT INTO pending_user_file_deletions(file_path) VALUES('/uploads/already-removed.jpg')");await cleanup();assert.equal((await pool.query('SELECT 1 FROM pending_user_file_deletions')).rowCount,0);});
});

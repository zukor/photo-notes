/* Requires the disposable local duplicate_test database and local app. */
const {Pool}=require('pg'),sharp=require('sharp'),bcrypt=require('bcryptjs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
(async()=>{
const pool=new Pool({connectionString:'postgresql://127.0.0.1:55573/duplicate_test'}),base='http://127.0.0.1:3197';
try{
const user=(await pool.query(`INSERT INTO users(email,name,password_hash,plan,pro_type) VALUES($1,'Duplicate Test',$2,'pro','general') RETURNING id`,['duplicate@test.invalid',bcrypt.hashSync('local-test-only',4)])).rows[0];
const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'duplicate@test.invalid',password:'local-test-only'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
const upload=async(bytes,source,coords)=>{const fd=new FormData();fd.append('photo',new Blob([bytes],{type:'image/jpeg'}),'new.jpg');fd.append('note','new observation');fd.append('area_tags','["Pavement"]');if(source)fd.append('context_source_id',source);if(coords){fd.append('latitude','41');fd.append('longitude','-88');fd.append('address','Original address');}const r=await fetch(base+'/api/captures',{method:'POST',headers:{Cookie:cookie},body:fd});assert.equal(r.status,200,await r.clone().text());return r.json();};
const originalBytes=await sharp({create:{width:24,height:24,channels:3,background:'#ff0000'}}).jpeg().toBuffer(),newBytes=await sharp({create:{width:24,height:24,channels:3,background:'#00ff00'}}).jpeg().toBuffer();
const original=await upload(originalBytes,null,true),before=await pool.query('SELECT * FROM capture_evidence WHERE capture_id=$1',[original.id]);
const copy=await upload(newBytes,original.id,false);assert.notEqual(copy.id,original.id);assert.notEqual(copy.photo_path,original.photo_path);assert.equal(copy.latitude,null);assert.equal(copy.longitude,null);assert.equal(copy.address,null);
const after=(await pool.query('SELECT * FROM capture_evidence WHERE capture_id=$1',[copy.id])).rows[0];assert.equal(after.original_sha256,crypto.createHash('sha256').update(newBytes).digest('hex'));assert.notEqual(after.original_sha256,before.rows[0].original_sha256);assert.notEqual(after.captured_at.getTime(),before.rows[0].captured_at.getTime());
assert.deepEqual((await pool.query('SELECT * FROM capture_evidence WHERE capture_id=$1',[original.id])).rows,before.rows);
const history=(await pool.query('SELECT * FROM capture_history WHERE capture_id=$1',[copy.id])).rows;assert.equal(history.filter(h=>h.action==='captured').length,1);assert.deepEqual(history.find(h=>h.action==='context_reused').detail,{source_capture_id:original.id});
const fd=new FormData();fd.append('note','notes alone');fd.append('context_source_id',original.id);assert.equal((await fetch(base+'/api/captures',{method:'POST',headers:{Cookie:cookie},body:fd})).status,400);
const foreign=(await pool.query(`INSERT INTO users(email,password_hash,plan,pro_type) VALUES('other@test.invalid','unused','pro','general') RETURNING id`)).rows[0];await pool.query('UPDATE captures SET user_id=$1 WHERE id=$2',[foreign.id,original.id]);const unauthorized=await upload(newBytes,original.id,false);assert.equal((await pool.query("SELECT * FROM capture_history WHERE capture_id=$1 AND action='context_reused'",[unauthorized.id])).rowCount,0);
console.log('Real local HTTP uploads: distinct records/files/fingerprints/timestamps, unchanged source evidence, independent location/history, new-photo guard and provenance ownership passed');
}finally{await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});

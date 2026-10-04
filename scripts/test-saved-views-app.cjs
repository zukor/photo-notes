'use strict';
const assert=require('node:assert/strict'),jwt=require('jsonwebtoken');
(async()=>{
 const url=process.env.SAVED_VIEWS_APP_TEST_DATABASE_URL;if(!url||!new URL(url).pathname.endsWith('/pn_saved_views_app_test'))throw Error('Dedicated pn_saved_views_app_test database required');
 process.env.DATABASE_URL=url;process.env.SESSION_SECRET='saved-views-local-test-session-secret';process.env.UPLOAD_DIR='/tmp/pn-saved-views-test-uploads';
 const {pool,init}=require('../db');await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');await init();
 const {app}=require('../server');const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  const users=(await pool.query("INSERT INTO users(email,name,password_hash,plan,pro_type) VALUES('sv-one@example.invalid','Saved Views One','unused','pro','general'),('sv-two@example.invalid','Saved Views Two','unused','pro','general') RETURNING id")).rows;
  const one=users[0].id,two=users[1].id;
  const job=(await pool.query("INSERT INTO jobs(user_id,name) VALUES($1,'Main Street') RETURNING id",[one])).rows[0].id;
  const foreignJob=(await pool.query("INSERT INTO jobs(user_id,name) VALUES($1,'Private Property') RETURNING id",[two])).rows[0].id;
  await pool.query("INSERT INTO captures(user_id,job_id,photo_path,note,area_tags,favorite) VALUES($1,$2,'/logo.svg','drainage',ARRAY['Exterior'],true),($3,$4,'/logo.svg','drainage private',ARRAY['Exterior'],true)",[one,job,two,foreignJob]);
  const request=async(path,method='GET',body,owner=one)=>{const cookie='pn_token='+jwt.sign({id:owner,plan:'pro',pro_type:'general'},process.env.SESSION_SECRET);const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
  const unauth=await fetch(`http://127.0.0.1:${server.address().port}/api/saved-views?workspace=organize`);assert.equal(unauth.status,401);
  const criteria={version:1,filters:{search:'drainage',topic:'Exterior',job:String(job),favorite:true}};
  const saved=await request('/api/saved-views','POST',{workspace:'organize',name:'Main Street drainage',description:'',is_default:true,criteria});assert.equal(saved.status,200);assert.deepEqual(saved.data.criteria,criteria);
  const search='/api/captures/search?'+new URLSearchParams({q:'drainage',job_id:String(job),favorite:'1'});
  assert.equal((await request(search)).data.length,1);
  await pool.query("INSERT INTO captures(user_id,job_id,photo_path,note,area_tags,favorite) VALUES($1,$2,'/logo.svg','drainage tomorrow',ARRAY['Exterior'],true)",[one,job]);
  assert.equal((await request(search)).data.length,2);assert.equal((await request('/api/saved-views?workspace=organize')).data[0].criteria.filters.job,String(job));
  assert.equal((await request('/api/captures/search?q=drainage&job_id='+foreignJob)).data.length,0);
  assert.equal((await request(search,'GET',null,two)).data.length,0);assert.equal((await request('/api/saved-views?workspace=organize','GET',null,two)).data.length,0);
  assert.equal((await request('/api/saved-views/'+saved.data.id,'PUT',{workspace:'organize',name:'Stolen',description:'',is_default:false,criteria},two)).status,404);
  await pool.query("UPDATE users SET plan='free' WHERE id=$1",[one]);assert.equal((await request('/api/saved-views?workspace=organize')).status,403);
  console.log('PASS: full app and PostgreSQL, anonymous denial, current account/edition gate, Saved View persistence, new matching photos, foreign-job filtering, cross-user photo isolation and view mutation denial');
 }finally{server.close();await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});

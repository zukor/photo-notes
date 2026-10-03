'use strict';
const assert=require('node:assert/strict'),express=require('express'),{Pool}=require('pg'),crypto=require('node:crypto');
const cf=require('../custom-fields');
(async()=>{
 const url=process.env.CUSTOM_FIELDS_TEST_DATABASE_URL;if(!url||new URL(url).pathname!='/pn_custom_fields_test')throw Error('Dedicated pn_custom_fields_test database required');
 const pool=new Pool({connectionString:url});await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
 await pool.query(`CREATE TABLE users(id INT PRIMARY KEY);CREATE TABLE captures(id INT PRIMARY KEY,user_id INT REFERENCES users(id),photo_path TEXT,latitude DOUBLE PRECISION,longitude DOUBLE PRECISION,created_at TIMESTAMPTZ DEFAULT now());CREATE TABLE capture_history(capture_id INT,user_id INT,action TEXT,detail JSONB);INSERT INTO users VALUES(1),(2);INSERT INTO captures VALUES(1,1,'/original.jpg',29,-98,now()),(2,2,'/other.jpg',30,-97,now());`);
 await pool.query(cf.SCHEMA);await pool.query(cf.SCHEMA);
 let raceId=null,raceCount=0,raceResolve;let raceBarrier;const guardedPool={query:(...args)=>pool.query(...args),connect:async()=>{const client=await pool.connect();return {query:async(sql,params)=>{const r=await client.query(sql,params);if(sql==='SELECT * FROM custom_field_definitions WHERE id=$1'&&params[0]===raceId){if(++raceCount===2)raceResolve();await raceBarrier;}return r;},release:()=>client.release()};}};
 let edition='general';const app=express();app.use(express.json());cf.register(app,{pool:guardedPool,requireAuth:(req,res,next)=>{req.user={id:Number(req.headers['x-user']||1),plan:'pro',role:'user'};next();},currentProduct:async()=>edition});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const request=async(path,method='GET',body,user=1)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'Content-Type':'application/json','x-user':String(user)},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 try{
  for(const e of ['general','paving','concrete','property','hoa','contractor','roofer']){edition=e;assert.equal((await request('/api/custom-fields')).status,200);}
  for(const e of ['basic','issue','roads']){edition=e;assert.equal((await request('/api/custom-fields')).status,403);}edition='general';
  const id=crypto.randomUUID(),base={name:'Surface Type',type:'choice',scope:'general',prompt:'Select surface',required:false,active:true,options:['Asphalt','Concrete','Gravel']};
  let r=await request('/api/custom-fields/'+id,'PUT',base);assert.equal(r.status,200);assert.equal(r.data.revision,1);
  assert.equal((await request('/api/custom-fields/'+id,'PUT',base,2)).status,404);
  assert.equal((await request('/api/custom-fields', 'GET',null,2)).data.length,0);
  assert.equal((await request('/api/custom-fields/'+id,'PUT',{...base,type:'text'})).status,400);
  const fields=await cf.captureValues(pool,1,'pro',[{id,revision:1,value:'Gravel'}]);await pool.query('UPDATE captures SET custom_fields=$1 WHERE id=1',[JSON.stringify(fields)]);
  assert.equal((await request('/api/captures/1/custom-fields','PUT',{values:[{id,value:'Gravel'}]},2)).status,404);
  const before=(await pool.query('SELECT photo_path,latitude,longitude,created_at FROM captures WHERE id=1')).rows[0];
  assert.equal((await request('/api/custom-fields/'+id,'PUT',{...base,name:'Surface',options:['Asphalt']})).status,200);
  assert.equal((await request('/api/captures/1/custom-fields','PUT',{values:[{id,value:'Gravel'}]})).status,200);
  assert.equal((await pool.query('SELECT * FROM capture_history')).rowCount,0);
  assert.equal((await request('/api/captures/1/custom-fields','PUT',{values:[{id,value:'Asphalt'}]})).status,200);
  const history=(await pool.query('SELECT * FROM capture_history')).rows;assert.equal(history.length,1);assert.equal(history[0].detail.before[0].value,'Gravel');assert.equal(history[0].detail.after[0].value,'Asphalt');
  assert.deepEqual((await pool.query('SELECT photo_path,latitude,longitude,created_at FROM captures WHERE id=1')).rows[0],before);
  await request('/api/custom-fields/'+id,'PUT',{...base,active:false,options:['Asphalt']});
  const queued=await cf.captureValues(pool,1,'pro',[{id,revision:1,value:'Gravel'}]);assert.equal(queued[0].name,'Surface Type');assert.equal(queued[0].value,'Gravel');
  assert.equal((await request('/api/captures/1/custom-fields','PUT',{values:[{id,value:'Concrete'}]})).status,400);
  raceId=crypto.randomUUID();raceBarrier=new Promise(r=>raceResolve=r);const raced=await Promise.all([request('/api/custom-fields/'+raceId,'PUT',{...base,name:'Owner 1'},1),request('/api/custom-fields/'+raceId,'PUT',{...base,name:'Owner 2'},2)]);assert.deepEqual(raced.map(r=>r.status).sort(),[200,404]);const winner=(await pool.query('SELECT user_id,name FROM custom_field_definitions WHERE id=$1',[raceId])).rows[0];assert.equal(winner.name,'Owner '+winner.user_id);await pool.query('UPDATE custom_field_definitions SET active=false WHERE id=$1',[raceId]);raceId=null;
  for(let i=0;i<12;i++)assert.equal((await request('/api/custom-fields/'+crypto.randomUUID(),'PUT',{...base,name:'Field '+i,type:'text'})).status,200);
  assert.equal((await request('/api/custom-fields/'+crypto.randomUUID(),'PUT',{...base,type:'text'})).status,400);
  assert.equal((await request('/api/custom-fields/'+crypto.randomUUID(),'PUT',{...base,type:'text',scope:'edition',edition:'pro'})).status,200);
  assert.equal((await request('/api/custom-fields/'+crypto.randomUUID(),'PUT',{...base,scope:'edition',edition:'property'})).status,403);
  console.log('PASS: PostgreSQL/HTTP, schema idempotence, seven Pro gates, three exclusions, ownership and concurrent UUID collision isolation, immutable types/scopes, choice history, offline revisions, evidence preservation, edit audit, field limits');
 }finally{server.close();await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});

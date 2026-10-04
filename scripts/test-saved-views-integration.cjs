'use strict';
const assert=require('node:assert/strict'),express=require('express'),{Pool}=require('pg'),{SCHEMA,register}=require('../saved-views');
(async()=>{const url=process.env.SAVED_VIEWS_TEST_DATABASE_URL;if(!url||!new URL(url).pathname.endsWith('/pn_saved_views_test'))throw Error('Dedicated pn_saved_views_test database required');const pool=new Pool({connectionString:url});
 await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE TABLE users(id INT PRIMARY KEY); INSERT INTO users VALUES(1),(2)');await pool.query(SCHEMA);await pool.query(SCHEMA);
 let edition='general';const app=express();app.use(express.json());register(app,{pool,requireAuth:(req,res,next)=>{req.user={id:Number(req.headers['x-user']||1)};next();},currentProduct:async()=>edition});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const request=async(path,method='GET',body,user=1)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/saved-views${path}`,{method,headers:{'Content-Type':'application/json','x-user':String(user)},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 const body={workspace:'organize',name:'Main Street drainage',description:'Urgent evidence',is_default:true,criteria:{version:1,filters:{search:'drainage',job:'8',topic:'Exterior',favorite:true,from:'2026-10-01',missingAddress:true}}};
 try{
  for(const e of ['basic','issue','roads']){edition=e;for(const [path,method,b] of [['?workspace=organize','GET'],['','POST',body],['/00000000-0000-4000-8000-000000000001','PUT',body],['/00000000-0000-4000-8000-000000000001','DELETE',body]])assert.equal((await request(path,method,b)).status,403);}
  for(const e of ['general','paving','concrete','property','hoa','contractor','roofer']){edition=e;const saved=await request('','POST',body);assert.equal(saved.status,200);assert.deepEqual(saved.data.criteria,body.criteria);assert.equal((await request('?workspace=organize')).data.length,1);}
  edition='general';const original=(await request('?workspace=organize')).data[0];assert.equal((await request('?workspace=organize','GET',null,2)).data.length,0);
  assert.equal((await request('/'+original.id,'PUT',body,2)).status,404);assert.equal((await request('/'+original.id,'DELETE',body,2)).status,404);
  assert.equal((await request('/'+original.id,'PUT',{...body,workspace:'maintenance'})).status,400);
  edition='concrete';assert.equal((await request('/'+original.id,'PUT',body)).status,404);assert.equal((await request('/'+original.id,'DELETE',body)).status,404);
  edition='general';const saves=await Promise.all(Array.from({length:8},(_,i)=>request('','POST',{...body,name:'Default '+i})));assert(saves.every(r=>r.status===200));assert.equal((await request('?workspace=organize')).data.filter(v=>v.is_default).length,1);
  const renamed=await request('/'+original.id,'PUT',{...body,name:'Renamed',is_default:false});assert.equal(renamed.status,200);assert.equal(renamed.data.name,'Renamed');assert.deepEqual(renamed.data.criteria,body.criteria);
  assert.equal((await request('','POST',{...body,criteria:{version:1,filters:{ids:'1,2'}}})).status,400);
  edition='property';const maintenance=await request('','POST',{...body,workspace:'maintenance',criteria:{version:1,filters:{community:'1',status:'completed',priority:'high',recordType:'maintenance',propertyArea:'3',showClosed:true,search:'drainage'}}});assert.equal(maintenance.status,200);assert.equal((await request('?workspace=maintenance')).data.length,1);assert.equal((await request('?workspace=organize')).data.length,1);
  edition='general';assert.equal((await request('/'+original.id,'DELETE',body)).status,200);assert.equal((await request('/'+original.id,'DELETE',body)).status,404);
  await pool.query('DELETE FROM users WHERE id=1');assert.equal((await pool.query('SELECT * FROM saved_views')).rowCount,0);
  console.log('PASS: real PostgreSQL/HTTP, idempotent schema, seven editions, excluded editions, owner/edition/workspace isolation, atomic concurrent Default, rename, replacement, deletion and cascade');
 }finally{server.close();await pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});

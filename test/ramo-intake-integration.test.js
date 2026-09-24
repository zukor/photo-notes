const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('crypto');
const fs=require('fs/promises');
const path=require('path');
const database=process.env.PN_RAMO_TEST_DATABASE_URL;
test('Ramo sender persists groups, scopes ownership, and resumes exact manifest after failure',{skip:!database,timeout:60000},async()=>{
 assert.equal(database,'postgresql://postgres@127.0.0.1:55496/pn_ramo_test');
 Object.assign(process.env,{DATABASE_URL:database,PGSSL:'disable',ADMIN_EMAIL:'ramo-test@example.invalid',ADMIN_PASSWORD:'local-testing-only',RAMO_INTAKE_TOKEN:'local-test-token',SESSION_SECRET:'local-ramo-testing-secret'});
 const {pool,init}=require('../db');await init();
 const id=(await pool.query('SELECT id FROM users WHERE email=$1',[process.env.ADMIN_EMAIL])).rows[0].id;
 process.env.SUPER_ADMIN_USER_IDS=String(id);
 await pool.query("UPDATE users SET role='admin',plan='pro',pro_type='concrete',edition_access=ARRAY['concrete'] WHERE id=$1",[id]);
 const dir=await fs.mkdtemp('/tmp/pn-ramo-integration-');
 const png=await require('sharp')({create:{width:40,height:40,channels:3,background:'#0066cc'}}).png().toBuffer();
 await fs.writeFile(path.join(dir,'original.png'),png);
 const captures=[];
 for(let i=0;i<2;i++)captures.push((await pool.query("INSERT INTO captures(user_id,photo_path,note) VALUES($1,'/uploads/original.png',$2) RETURNING id",[id,`Photo ${i+1}`])).rows[0].id);
 const express=require('express'),app=express();app.use(express.json({limit:'2mb'}));
 const {registerRamoIntake}=require('../ramo-intake');
 const worker=registerRamoIntake(app,{pool,uploadDir:dir,requireAuth:(req,res,next)=>{req.user={id:req.get('x-test-foreign')?999999:id,role:'admin',name:'Synthetic Tester'};next();},requireConcrete:(req,res,next)=>next()});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`,nativeFetch=global.fetch,received=new Map(),putCounts=new Map();let failSecond=true,manifest,intakeId=crypto.randomUUID();
 global.fetch=async(url,options)=>{
 if(!String(url).startsWith('https://ramo-optimizer.up.railway.app/'))return nativeFetch(url,options);
 const send=b=>new Response(JSON.stringify(b),{headers:{'Content-Type':'application/json'}});
 if(String(url).endsWith('/submissions')){const m=JSON.parse(options.body);if(manifest)assert.deepEqual(m,manifest);manifest=m;return send({intakeId,submissionId:m.submissionId,missingAttachmentIds:m.attachments.filter(a=>!received.has(a.id)).map(a=>a.id)});}
 if(String(url).endsWith('/complete'))return send({intakeId,submissionId:manifest.submissionId,status:'received',receivedAt:new Date().toISOString(),attachmentCount:2});
 const attachmentId=String(url).split('/').at(-1);if(received.size===1&&failSecond){failSecond=false;throw Error('simulated lost connection');}
 received.set(attachmentId,options.body);putCounts.set(attachmentId,(putCounts.get(attachmentId)||0)+1);return send({attachmentId,stored:true});
 };
 const post=(url,b,headers={})=>nativeFetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(b)});
 const waitStatus=async(status)=>{for(let i=0;i<100;i++){const row=(await pool.query('SELECT * FROM ramo_intake_submissions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[id])).rows[0];if(row?.status===status)return row;await new Promise(r=>setTimeout(r,30));}throw Error('status timeout '+status);};
 try{
 await pool.query('DELETE FROM ramo_intake_submissions WHERE user_id=$1',[id]);
 assert.equal((await nativeFetch(base+'/api/ramo-intake',{headers:{'x-test-foreign':'1'}})).status,403);
 assert.equal((await post('/api/ramo-intake/preview',{captureIds:[999999]})).status,404);
 const payload={requestId:crypto.randomUUID(),title:'Synthetic wall request',description:'Add one foot',photos:captures.map((captureId,i)=>({captureId,caption:`Photo ${i+1}`}))};
 assert.equal((await post('/api/ramo-intake/submissions',payload,{Origin:'https://attacker.invalid'})).status,403);
 const first=await post('/api/ramo-intake/submissions',payload);assert.equal(first.status,201);const firstRow=await first.json();
 const failed=await waitStatus('failed');assert.equal(failed.manifest.attachments.length,2);assert.equal(received.size,1);
 assert.equal((await post('/api/ramo-intake/submissions',payload)).status,200);
 assert.equal((await post('/api/ramo-intake/submissions',{...payload,title:'Changed'})).status,409);
 assert.equal(Number((await pool.query('SELECT count(*) FROM ramo_intake_submissions WHERE user_id=$1',[id])).rows[0].count),1);
 await fs.writeFile(path.join(dir,'original.png'),Buffer.from('source changed after snapshot'));
 assert.equal((await post(`/api/ramo-intake/submissions/${firstRow.id}/retry`,{})).status,200);
 const complete=await waitStatus('received');assert.equal(complete.receipt.attachmentCount,2);assert.equal(received.size,2);
 for(const bytes of received.values())assert.deepEqual(bytes,png);for(const count of putCounts.values())assert.equal(count,1);
 assert.deepEqual(manifest.attachments.map(a=>a.caption),['Photo 1','Photo 2']);
 assert.equal((await post(`/api/ramo-intake/submissions/${firstRow.id}/retry`,{},{'x-test-foreign':'1'})).status,403);
 }finally{global.fetch=nativeFetch;await new Promise(r=>server.close(r));await pool.query('DELETE FROM ramo_intake_submissions WHERE user_id=$1',[id]);await pool.query('DELETE FROM captures WHERE id=ANY($1::int[])',[captures]);await pool.end();await fs.rm(dir,{recursive:true,force:true});}
});

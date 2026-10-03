// Disposable local schema only. Includes real authorization, PNG generation and asset capture.
const assert=require('node:assert/strict'),crypto=require('crypto'),fs=require('node:fs/promises'),os=require('os'),path=require('path');
const connection=process.env.PN_QR_TEST_DATABASE_URL;
if(!connection||!['localhost','127.0.0.1'].includes(new URL(connection).hostname))throw new Error('Set PN_QR_TEST_DATABASE_URL to a disposable local database.');
(async()=>{
 const schema='qr_test_'+crypto.randomBytes(6).toString('hex'),bootstrap=new(require('pg').Pool)({connectionString:connection});await bootstrap.query('CREATE SCHEMA '+schema);
 const url=new URL(connection);url.searchParams.set('options','-c search_path='+schema);process.env.DATABASE_URL=url.toString();process.env.PGSSL='';process.env.SESSION_SECRET='qr-disposable-test-secret';const uploads=await fs.mkdtemp(path.join(os.tmpdir(),'pn-qr-upload-'));process.env.UPLOAD_DIR=uploads;
 const {pool,init}=require('../db');let server;
 try{
 await init();const {app}=require('../server');server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const user=async(name,edition='property',plan='pro')=>(await pool.query('INSERT INTO users(email,name,password_hash,plan,pro_type,active) VALUES($1,$2,$3,$4,$5,true) RETURNING id',[name+'@qr.test',name,'unused',plan,edition])).rows[0].id;
 const owner=await user('owner'),other=await user('other'),member=await user('member');
 const call=(p,{id=owner,body,method='GET'}={})=>fetch(base+p,{method,headers:{...(id?{Cookie:'pn_token='+require('jsonwebtoken').sign({id},process.env.SESSION_SECRET)}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,redirect:'manual'});
 const company=(await pool.query("INSERT INTO hoa_management_companies(name) VALUES('QR Company') RETURNING id")).rows[0].id;
 for(const id of [owner,member])await pool.query("INSERT INTO hoa_company_members(company_id,user_id,company_role) VALUES($1,$2,'manager')",[company,id]);
 const community=(await pool.query("INSERT INTO hoa_communities(company_id,name) VALUES($1,'Test Property') RETURNING id",[company])).rows[0].id;
 const asset=(await pool.query("INSERT INTO hoa_assets(company_id,community_id,name,asset_type) VALUES($1,$2,'Gate 7','Gate') RETURNING id",[company,community])).rows[0].id;
 const p='/api/qr/asset/'+asset,create=await call(p,{method:'POST',body:{action:'create'}});assert.equal(create.status,200,await create.clone().text());const d=await create.json(),token=d.url.split('/').pop();assert.match(token,/^[A-Za-z0-9_-]{43}$/);
 assert.equal((await call('/qr/'+token,{id:null})).status,302);assert.equal((await call('/api/qr/resolve/'+token,{id:null})).status,401);assert.equal((await call('/api/qr/resolve/'+token,{id:other})).status,404);assert.equal((await call(p,{id:other,method:'POST',body:{action:'disable'}})).status,404);
 assert.equal((await call('/api/qr/resolve/'+token,{id:member})).status,200);const png=await call(p+'/image');assert.equal(png.status,200);const bytes=Buffer.from(await png.arrayBuffer());assert.equal(bytes.subarray(1,4).toString(),'PNG');
 const image=await require('sharp')({create:{width:30,height:20,channels:3,background:'#123456'}}).jpeg().toBuffer(),fd=new FormData();fd.append('photo',new Blob([image],{type:'image/jpeg'}),'condition.jpg');fd.append('photo_type','condition');fd.append('note','QR condition');
 assert.equal((await call('/api/hoa/assets/'+asset+'/photos',{method:'POST',body:fd})).status,200);const history=await(await call('/api/hoa/assets/'+asset)).json();assert.equal(history.photos.length,1);assert.equal(history.photos[0].note,'QR condition');
 const reissued=await(await call(p,{method:'POST',body:{action:'reissue'}})).json();assert.notEqual(reissued.url,d.url);assert.equal((await call('/api/qr/resolve/'+token)).status,404);await call(p,{method:'POST',body:{action:'disable'}});assert.equal((await call('/api/qr/resolve/'+reissued.url.split('/').pop())).status,404);assert.equal((await call('/api/hoa/assets/'+asset)).status,200);
 const note=(await pool.query("INSERT INTO captures(user_id,note) VALUES($1,'Saved note') RETURNING id",[owner])).rows[0].id;
 for(const edition of ['general','property','hoa','concrete','paving','contractor','roofer']){await pool.query('UPDATE users SET pro_type=$1 WHERE id=$2',[edition,owner]);assert.equal((await call('/api/qr/note/'+note,{method:'POST',body:{action:'create'}})).status,200,edition);}
 for(const [edition,plan] of [['general','free'],['issue','pro'],['roads','pro']]){await pool.query('UPDATE users SET pro_type=$1,plan=$2 WHERE id=$3',[edition,plan,owner]);assert.equal((await call('/api/qr/note/'+note)).status,404);}
 console.log('QR integration passed: edition gates, cross-account/company isolation, signed-out scans, reissue/revoke, PNG, and existing asset photo history.');
 }finally{if(server)await new Promise(r=>server.close(r));await pool.end();await bootstrap.query('DROP SCHEMA '+schema+' CASCADE');await bootstrap.end();await fs.rm(uploads,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});

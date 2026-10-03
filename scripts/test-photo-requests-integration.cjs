// Uses a disposable local PostgreSQL database only. Never points at the app database.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),sharp=require('sharp'),jwt=require('jsonwebtoken');
const connection=process.env.PN_REQUEST_TEST_DATABASE_URL;
if(!connection||!['localhost','127.0.0.1'].includes(new URL(connection).hostname))throw new Error('Set PN_REQUEST_TEST_DATABASE_URL to a disposable local database.');
process.env.DATABASE_URL=connection;process.env.PGSSL='';process.env.SESSION_SECRET='photo-request-disposable-test-secret-123456789';
(async()=>{
 const uploads=await fs.mkdtemp(path.join(os.tmpdir(),'pn-request-upload-'));process.env.UPLOAD_DIR=uploads;
 const bootstrap=new (require('pg').Pool)({connectionString:connection});
 const schema='photo_requests_test_'+require('crypto').randomBytes(6).toString('hex');await bootstrap.query('CREATE SCHEMA '+schema);
 const scoped=new URL(connection);scoped.searchParams.set('options','-c search_path='+schema);process.env.DATABASE_URL=scoped.toString();
 const {pool,init}=require('../db');await init();
 const {app}=require('../server');const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 try{
 const owner=(await pool.query("INSERT INTO users(email,name,password_hash,plan,pro_type,active) VALUES('requests-owner@test.local','Request Owner','unused','pro','general',true) RETURNING id")).rows[0].id;
 const other=(await pool.query("INSERT INTO users(email,name,password_hash,plan,pro_type,active) VALUES('requests-other@test.local','Other','unused','pro','general',true) RETURNING id")).rows[0].id;
 const cookie=id=>'pn_token='+jwt.sign({id},process.env.SESSION_SECRET);
 const call=async(url,{id=owner,body,method='GET'}={})=>fetch(base+url,{method,headers:{...(id?{Cookie:cookie(id)}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const create=async(extra={})=>{const r=await call('/api/photo-requests',{method:'POST',body:{title:'HVAC test',instructions:'Photograph requested views',views:['Overall','Plate'],...extra}});assert.equal(r.status,200,await r.clone().text());return r.json();};
 const image=await sharp({create:{width:32,height:24,channels:3,background:'#123456'}}).jpeg().toBuffer();
 const submit=async(token,indices,{name='Contractor',bytes=image}={})=>{const fd=new FormData();fd.append('view_indices',JSON.stringify(indices));fd.append('notes',JSON.stringify(indices.map(i=>'Note '+i)));fd.append('submitter_name',name);indices.forEach((i,n)=>fd.append('photos',new Blob([Array.isArray(bytes)?bytes[n]:bytes],{type:'image/jpeg'}),'view-'+i+'.jpg'));return fetch(base+'/api/public/photo-requests/'+token,{method:'POST',body:fd});};
 const request=await create();assert.equal((await call('/api/photo-requests/'+request.id,{id:other})).status,404);assert.equal((await call('/api/photo-requests/'+request.id+'/cancel',{id:other,method:'POST'})).status,409);
 const publicData=await (await call('/api/public/photo-requests/'+request.token,{id:null})).json();assert.equal(publicData.sender_name,'Request Owner');for(const key of ['user_id','id','token','related_capture_id','item_id','photo_path'])assert.equal(key in publicData,false);
 assert.equal((await submit(request.token,[0])).status,400);assert.equal((await submit(request.token,[0,1],{bytes:Buffer.from('<svg></svg>')})).status,400);assert.equal((await fs.readdir(uploads)).length,0);
 const png=await sharp(image).png().toBuffer();assert.equal((await submit(request.token,[0,1],{bytes:[png,Buffer.from('not an image')]})).status,400);assert.equal((await fs.readdir(uploads)).length,0);
 const race=await Promise.all([submit(request.token,[0,1]),submit(request.token,[0,1])]);assert.deepEqual(race.map(r=>r.status).sort(),[200,400]);
 assert.equal((await submit(request.token,[0,1])).status,410);assert.equal((await call('/photo-request/'+request.token,{id:null})).status,410);
 const detail=await (await call('/api/photo-requests/'+request.id)).json();assert.equal(detail.request.status,'completed');assert.equal(detail.photos.length,2);assert.equal(detail.photos[0].submitter_name,'Contractor');assert.equal(detail.photos[0].note,'Note 0');assert.equal(detail.photos[0].original_name,'view-0.jpg');assert.match(detail.photos[0].original_sha256,/^[a-f0-9]{64}$/);assert.equal(Number(detail.photos[0].original_bytes),image.length);assert(detail.photos[0].submitted_at);assert(detail.history.some(h=>h.action==='completed'));
 const library=await (await call('/api/captures')).json();assert(library.some(c=>c.id===detail.photos[0].capture_id));
 const evidenceResponse=await call('/api/captures/'+detail.photos[0].capture_id+'/evidence');assert.equal(evidenceResponse.status,200);assert.equal((await evidenceResponse.json()).fingerprint_verified,true);
 const groupResponse=await call('/api/groups',{method:'POST',body:{title:'Requested-photo report',ids:detail.photos.map(p=>p.capture_id)}});assert.equal(groupResponse.status,200);
 const caps=(await pool.query('SELECT * FROM captures WHERE user_id=$1',[owner])).rows;assert.equal(caps.length,2);assert(caps.every(c=>c.photo_title.includes('HVAC test')&&c.photo_path));assert.equal((await fs.readdir(uploads)).length,2);
 const partial=await create({allow_partial:true});assert.equal((await submit(partial.token,[0])).status,200);assert.equal((await (await call('/api/photo-requests/'+partial.id)).json()).request.status,'partially_submitted');assert.equal((await submit(partial.token,[0])).status,400);assert.equal((await submit(partial.token,[1])).status,200);
 const job=(await pool.query("INSERT INTO jobs(user_id,name) VALUES($1,'Equipment job') RETURNING id",[owner])).rows[0].id;
 const source=(await pool.query("INSERT INTO captures(user_id,kind,job_id,area_tags) VALUES($1,'note',$2,ARRAY['Equipment']) RETURNING id",[owner,job])).rows[0].id;const linked=await create({related_capture_id:source});assert.equal((await submit(linked.token,[0,1])).status,200);const inherited=(await pool.query('SELECT c.* FROM captures c JOIN photo_request_photos p ON p.capture_id=c.id WHERE p.request_id=$1',[linked.id])).rows;assert(inherited.every(c=>c.job_id===job&&c.area_tags.includes('Equipment')));
 const cancelled=await create();assert.equal((await call('/api/photo-requests/'+cancelled.id+'/cancel',{method:'POST'})).status,200);assert.equal((await submit(cancelled.token,[0,1])).status,410);
 const expired=await create();await pool.query("UPDATE photo_requests SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.id]);assert.equal((await call('/api/public/photo-requests/'+expired.token,{id:null})).status,410);assert.equal((await (await call('/api/photo-requests/'+expired.id)).json()).request.status,'expired');
 const foreignCap=(await pool.query("INSERT INTO captures(user_id,kind) VALUES($1,'note') RETURNING id",[other])).rows[0].id;assert.equal((await call('/api/photo-requests',{method:'POST',body:{title:'Bad association',instructions:'Photo',views:['One'],related_capture_id:foreignCap}})).status,400);
 for(const edition of ['general','property','hoa','paving','concrete','contractor','roofer']){await pool.query("UPDATE users SET plan='pro',pro_type=$1 WHERE id=$2",[edition,owner]);assert.equal((await call('/api/photo-requests')).status,200);}
 for(const edition of ['general','issue','roads']){await pool.query("UPDATE users SET plan='free',pro_type=$1 WHERE id=$2",[edition,owner]);assert.equal((await call('/api/photo-requests')).status,403);}
 await pool.query("UPDATE users SET plan='pro',pro_type='property' WHERE id=$1",[owner]);
 const company=(await pool.query("INSERT INTO hoa_management_companies(name) VALUES('Test Management') RETURNING id")).rows[0].id;await pool.query("INSERT INTO hoa_company_members(company_id,user_id,company_role) VALUES($1,$2,'administrator'),($1,$3,'member')",[company,owner,other]);
 const community=(await pool.query("INSERT INTO hoa_communities(company_id,name) VALUES($1,'Test Property') RETURNING id",[company])).rows[0].id;
 const item=(await pool.query("INSERT INTO hoa_maintenance_items(company_id,community_id,title,area,created_by) VALUES($1,$2,'Repair test','Equipment',$3) RETURNING id",[company,community,owner])).rows[0].id;
 const related=await create({item_id:item});assert.equal((await submit(related.token,[0,1])).status,200);assert.equal((await pool.query('SELECT * FROM hoa_item_photos WHERE item_id=$1',[item])).rowCount,2);assert((await pool.query('SELECT * FROM hoa_notifications WHERE user_id=$1',[other])).rowCount>0);
 for(const edition of ['property','hoa']){
  await pool.query("UPDATE users SET pro_type=$1 WHERE id=$2",[edition,owner]);const r=await call('/api/hoa/items/'+item+'/completion-request',{method:'POST',body:{recipient_name:'Legacy Contractor'}});assert.equal(r.status,200);const legacy=await r.json();assert(Math.abs(new Date(legacy.expires_at)-Date.now()-14*86400000)<10000);const pathname=new URL(legacy.url).pathname;assert.equal((await call(pathname,{id:null})).status,200);
  const fd=new FormData();fd.append('submitter_name','Legacy Contractor');fd.append('note','Completed work');fd.append('photos',new Blob([image],{type:'image/jpeg'}),'completed.jpg');assert.equal((await fetch(base+pathname,{method:'POST',body:fd})).status,200);assert.equal((await call(pathname,{id:null})).status,410);
  const expiredLegacy=await (await call('/api/hoa/items/'+item+'/completion-request',{method:'POST',body:{recipient_name:'Expired link'}})).json();const expiredPath=new URL(expiredLegacy.url).pathname;await pool.query("UPDATE hoa_completion_photo_requests SET expires_at=now()-interval '1 second' WHERE token=$1",[expiredPath.split('/').pop()]);assert.equal((await call(expiredPath,{id:null})).status,410);
  const repeat=new FormData();repeat.append('photos',new Blob([image]),'repeat.jpg');assert.equal((await fetch(base+pathname,{method:'POST',body:repeat})).status,410);
 }
 assert.equal((await pool.query("SELECT * FROM hoa_item_photos WHERE item_id=$1 AND photo_stage='completed_work'",[item])).rowCount,2);
 if(process.env.PN_REQUEST_BROWSER==='1'){
  await pool.query("UPDATE users SET pro_type='general' WHERE id=$1",[owner]);
  const browser=await require('playwright').chromium.launch();
  try{
   const ownerContext=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});await ownerContext.addCookies([{name:'pn_token',value:jwt.sign({id:owner},process.env.SESSION_SECRET),url:base}]);
   await ownerContext.addInitScript(()=>localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed'));
   const ownerPage=await ownerContext.newPage();await ownerPage.goto(base);await ownerPage.locator('#prOpen').click();await ownerPage.locator('#prTitle').fill('Live browser request');await ownerPage.locator('#prInstructions').fill('Photograph the unit and its plate.');await ownerPage.locator('#prViews').fill('Overall\nEquipment Plate');await ownerPage.locator('#prCreate').click();await ownerPage.waitForFunction(()=>document.getElementById('prCreateStatus').textContent.includes('Request created'));
   const live=(await pool.query("SELECT * FROM photo_requests WHERE title='Live browser request' AND user_id=$1 ORDER BY id DESC LIMIT 1",[owner])).rows[0];assert(live);
   const publicContext=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'block'});const recipient=await publicContext.newPage();await recipient.goto(base+'/photo-request/'+live.token);await recipient.locator('#prPublicForm').waitFor();assert.equal((await publicContext.cookies()).length,0);
   await recipient.locator('#prChoose0').setInputFiles({name:'real-overall.jpg',mimeType:'image/jpeg',buffer:image});await recipient.locator('#prChoose1').setInputFiles({name:'real-plate.jpg',mimeType:'image/jpeg',buffer:image});await recipient.locator('#prSubmitter').fill('Outside Contractor');await recipient.locator('#prViewNote1').fill('Identification plate close-up');await recipient.screenshot({path:'/tmp/pn-photo-request-live-recipient.png',fullPage:true});await recipient.locator('#prPublicSubmit').click();await recipient.waitForFunction(()=>document.getElementById('prPublicStatus').textContent.includes('Photos received'));
   await ownerPage.locator('#prRefresh').click();const card=ownerPage.locator('#prList .pr-card').filter({hasText:'Live browser request'});await card.getByText('Completed', {exact:false}).waitFor();await card.locator('[data-pr-detail]').click();await ownerPage.locator('#prDetail [data-pr-photo]').first().waitFor();assert((await ownerPage.locator('#prDetail').innerText()).includes('Outside Contractor'));assert((await ownerPage.locator('#prDetail').innerText()).includes('Identification plate close-up'));await ownerPage.screenshot({path:'/tmp/pn-photo-request-live-owner.png',fullPage:true});await ownerPage.locator('#prDetail [data-pr-photo]').first().click();await ownerPage.locator('#cards .capchk:checked').waitFor();assert.equal(await ownerPage.locator('#cards .capchk:checked').count(),1);
   await recipient.reload();assert((await recipient.locator('body').innerText()).includes('closed or expired'));
   console.log('PASS: live Chromium end-to-end owner creation, account-free mobile recipient upload, completed receipt, owner evidence, and opening the normal Photo Note.');
   await ownerContext.close();await publicContext.close();
  }finally{await browser.close();}
 }
 console.log('PASS: real PostgreSQL creation, ownership, public isolation, required/partial views, invalid image cleanup, concurrent submission, evidence, normal captures, expiry/cancellation, edition gates, maintenance notifications, and legacy HOA/Property completion links.');
 }finally{await new Promise(r=>server.close(r));await pool.end();await bootstrap.query('DROP SCHEMA '+schema+' CASCADE');await bootstrap.end();await fs.rm(uploads,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});

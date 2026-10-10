const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('paired photos inherit jobs safely, date filters use local days, and area Back restores Edit',{skip:process.env.PN_ISSUE_FLOW_TEST!=='1',timeout:120000},async()=>{
 process.env.DATABASE_URL=process.env.PN_LEGACY_TEST_DATABASE_URL||'postgresql://127.0.0.1:55519/pn_issue_flow';process.env.PGSSL='disable';process.env.SESSION_SECRET='backlog-local-test';process.env.ISSUE_CLOUD_RUNNER_ENABLED='false';process.env.UPLOAD_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'pn-backlog-'));delete process.env.ANTHROPIC_API_KEY;delete process.env.RESEND_API_KEY;
 const {pool,init}=require('../db');assert.equal((await pool.query('SHOW data_directory')).rows[0].data_directory,process.env.PN_AUTOMATION_DATA_DIR||'/tmp/pn-issue-flow/db');await init();
 const {app}=require('../server'),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const u=(await pool.query("INSERT INTO users(email,password_hash,role,plan,pro_type,edition_access) VALUES($1,'none','user','pro','concrete',ARRAY['pro','contractor','paving','hoa','property','concrete','roofer']) RETURNING id",['backlog-'+Date.now()+'@example.invalid'])).rows[0];
 const cookie='pn_token='+require('jsonwebtoken').sign({id:u.id},process.env.SESSION_SECRET);const req=(url,body)=>fetch(base+url,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try{
 const jobA=(await pool.query("INSERT INTO jobs(user_id,name) VALUES($1,'Job A') RETURNING id",[u.id])).rows[0].id,jobB=(await pool.query("INSERT INTO jobs(user_id,name) VALUES($1,'Job B') RETURNING id",[u.id])).rows[0].id;
 fs.writeFileSync(path.join(process.env.UPLOAD_DIR,'photo.jpg'),await require('sharp')({create:{width:100,height:80,channels:3,background:'blue'}}).jpeg().toBuffer());
 const photo=async(job,date,title)=> (await pool.query("INSERT INTO captures(user_id,job_id,photo_path,photo_title,created_at) VALUES($1,$2,'/uploads/photo.jpg',$3,$4) RETURNING id",[u.id,job,title,date])).rows[0].id;
 const before=await photo(jobA,'2026-09-22T17:00:00Z','September 22 local'),after=await photo(null,'2026-09-22T20:00:00Z','September 23 local');
 assert.equal((await req('/api/pairs',{before_id:before,after_id:after})).status,200);
 assert.equal((await pool.query('SELECT job_id FROM captures WHERE id=$1',[after])).rows[0].job_id,jobA);
 assert.equal((await(await req('/api/captures/search?job_id='+jobA)).json()).length,2);
 const otherA=await photo(jobA,'2026-09-23T00:00:00Z','A'),otherB=await photo(jobB,'2026-09-23T00:00:00Z','B');assert.equal((await req('/api/pairs',{before_id:otherA,after_id:otherB})).status,200);assert.equal((await pool.query('SELECT job_id FROM captures WHERE id=$1',[otherB])).rows[0].job_id,jobB);
 const foreign=(await pool.query("INSERT INTO users(email,password_hash) VALUES($1,'none') RETURNING id",['foreign-'+Date.now()+'@example.invalid'])).rows[0].id;
 const privatePhoto=(await pool.query("INSERT INTO captures(user_id,photo_path) VALUES($1,'/uploads/photo.jpg') RETURNING id",[foreign])).rows[0].id;
 assert.equal((await req('/api/pairs',{before_id:before,after_id:privatePhoto})).status,403);await pool.query('DELETE FROM captures WHERE id=$1',[privatePhoto]);await pool.query('DELETE FROM users WHERE id=$1',[foreign]);
 const query=new URLSearchParams({from:'2026-09-22',to:'2026-09-22',from_at:'2026-09-21T19:00:00.000Z',to_before:'2026-09-22T19:00:00.000Z'});
 assert.deepEqual((await(await req('/api/captures/search?'+query)).json()).map(c=>c.id),[before]);assert.equal((await req('/api/captures/search?from_at=not-a-date')).status,400);
 for(const engine of ['chromium','webkit']){const browser=await require('playwright')[engine].launch();try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900},timezoneId:'Asia/Karachi',serviceWorkers:'block'});await page.context().addCookies([{name:'pn_token',value:cookie.split('=')[1],url:base}]);
 await page.goto(base);await page.waitForFunction(()=>state.me);await page.evaluate(()=>{localStorage.setItem('pn_first_use_v1:'+encodeURIComponent(state.me.email),'done');document.getElementById('firstUseSetup')?.close();});
 await page.evaluate(()=>{state.view='organize';renderApp();});await page.locator('#libraryFilters').click();await page.locator('#searchFrom').waitFor();await page.locator('#searchFrom').fill('2026-09-22');await page.locator('#searchTo').fill('2026-09-22');await page.waitForFunction(()=>document.querySelectorAll('#cards .capchk').length===1);assert.equal(await page.locator('#cards .capchk').inputValue(),String(before));
 await page.evaluate(()=>{window.loadLeaflet=async()=>{};state._libraryOpenId=Number(document.querySelector('.capchk')?.value);state.view='edit';renderApp();});await page.locator('.concrete-area-button').first().waitFor();await page.locator('.concrete-area-button').first().click();await page.locator('#areaBack').waitFor();assert.match(await page.locator('#areaBack').textContent(),/Library|Photo|Edit/);await page.locator('#areaBack').click();await page.locator('.concrete-area-button').first().waitFor();assert.equal(await page.evaluate(()=>state.view),'edit');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.close();
 }}finally{await browser.close();}}
 }finally{await new Promise(r=>server.close(r));await pool.query('DELETE FROM capture_pairs WHERE user_id=$1',[u.id]);await pool.query('DELETE FROM captures WHERE user_id=$1',[u.id]);await pool.query('DELETE FROM jobs WHERE user_id=$1',[u.id]);await pool.query('DELETE FROM users WHERE id=$1',[u.id]);await pool.end();}
});

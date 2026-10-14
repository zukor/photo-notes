'use strict';
const assert=require('node:assert/strict'),jwt=require('jsonwebtoken');
const target=new URL(process.env.DATABASE_URL||'');assert(['127.0.0.1','localhost'].includes(target.hostname));assert.equal(target.pathname,'/pn_library_projects_test');
(async()=>{const {pool,init}=require('../db');await init();let server;try{
 const {app}=require('../server');server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const owner=(await pool.query("INSERT INTO users(email,name,password_hash,plan,pro_type,edition_access) VALUES('library-owner@example.invalid','Library fixture','unused','pro','general',ARRAY['pro']) RETURNING id")).rows[0].id;
 const other=(await pool.query("INSERT INTO users(email,name,password_hash) VALUES('library-other@example.invalid','Other fixture','unused') RETURNING id")).rows[0].id;
 const job=async(user,name)=>(await pool.query('INSERT INTO jobs(user_id,name) VALUES($1,$2) RETURNING id',[user,name])).rows[0].id;
 const photo=async(user,note)=>(await pool.query('INSERT INTO captures(user_id,note) VALUES($1,$2) RETURNING id',[user,note])).rows[0].id;
 const first=await job(owner,'First project'),second=await job(owner,'Second project'),foreign=await job(other,'Private project');
 const one=await photo(owner,'Photo one'),two=await photo(owner,'Photo two'),three=await photo(owner,'Unassigned photo'),privatePhoto=await photo(other,'Private photo');
 const cookie='pn_token='+jwt.sign({id:owner},process.env.SESSION_SECRET);
 const api=async(url,body,auth=cookie)=>{const r=await fetch(base+url,{method:body?'POST':'GET',headers:{Cookie:auth,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json().catch(()=>({}))};};
 const assigned=await api('/api/library/assign',{ids:[one,two],project_id:first});assert.equal(assigned.status,200,JSON.stringify(assigned));assert.equal(assigned.data.updated,2);
 assert.equal((await api('/api/library/assign',{ids:[one,two],project_id:first})).status,200,'repeat assignment is idempotent');
 const group=(await api(`/api/projects/${second}/groups`,{name:'Inspection'})).data;assert(group.id);
 assert.equal((await api('/api/library/assign',{ids:[one,two],project_id:second,group_id:group.id})).status,200);
 const rows=(await api('/api/captures/search')).data;for(const id of [one,two]){const row=rows.find(x=>x.id===id);assert.equal(row.note,id===one?'Photo one':'Photo two');assert.deepEqual(row.project_memberships.map(x=>x.id).sort((a,b)=>a-b),[first,second]);assert.equal(row.project_memberships.find(x=>x.id===second).groups[0].id,group.id);}
 assert.equal((await api('/api/captures')).data.find(x=>x.id===one).project_memberships.length,2);
 assert.deepEqual((await api('/api/captures/search?job_id='+second)).data.map(x=>x.id).sort((a,b)=>a-b),[one,two]);
 assert.deepEqual((await api('/api/captures/search?job_id=unassigned')).data.map(x=>x.id),[three]);
 assert.equal((await api('/api/jobs')).data.find(x=>x.id===second).photo_count,2);
 assert.equal((await api(`/api/jobs/${second}/timeline`)).data.captures.length,2);
 assert.equal((await api(`/api/projects/${second}/groups`)).data[0].photo_count,2);
 assert.equal((await api('/api/library/assign',{ids:[three,privatePhoto],project_id:first})).status,403,'mixed ownership fails atomically');
 assert.equal((await pool.query('SELECT COUNT(*)::int n FROM capture_project_memberships WHERE capture_id=$1',[three])).rows[0].n,0);
 assert.equal((await api('/api/library/assign',{ids:[three],project_id:foreign})).status,403);
 assert.equal((await api('/api/library/assign',{ids:[three],project_id:first,group_id:group.id})).status,403,'group belongs to its project');
 assert.equal((await api('/api/library/assign',{ids:[one,-1],project_id:first})).status,400);
 assert.equal((await api('/api/library/assign',{ids:[one],project_id:first},'')).status,401);
 assert.equal((await api(`/api/projects/${foreign}/groups`)).status,403);
 assert.equal((await api(`/api/projects/${foreign}/groups`,{name:'Forbidden'})).status,403);
 const {chromium,webkit}=require('playwright');
 for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [390,1440]){const page=await browser.newPage({viewport:{width,height:950},serviceWorkers:'block'});await page.context().addCookies([{name:'pn_token',value:cookie.slice('pn_token='.length),url:base}]);await page.addInitScript(()=>{localStorage.setItem('pn_install_prompt_dismissed_v1','1');localStorage.setItem('pn_first_use_v1:library-owner%40example.invalid','done');});await page.goto(base);await page.waitForFunction(()=>state.me);
 for(const edition of ['general','property']){await page.evaluate(edition=>{state.plan='pro';state.proType=edition;state.view=edition==='property'?'photo-library':'organize';renderApp();},edition);await page.locator('.library-photo-card').first().waitFor();await page.locator('.capchk[value="'+one+'"]').check();await page.locator('.capchk[value="'+two+'"]').check();await page.locator('#libraryAssignProject').selectOption(String(second));await page.waitForFunction(()=>!document.getElementById('libraryAssignGroupLabel').hidden);await page.locator('#libraryAssignGroup').selectOption(String(group.id));await page.locator('#libraryAssign').click();await page.waitForFunction(()=>state.selectedIds.size===0);await page.locator('.library-photo-card').first().waitFor();assert.match(await page.locator('[data-library-photo="'+one+'"]').innerText(),/First project, Second project/);assert.match(await page.locator('[data-library-photo="'+one+'"]').innerText(),/Second project: Inspection/);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.close();console.log(engine.name(),width,'actual-server Pro/Property Library assignment and refreshed memberships PASS');}}finally{await browser.close();}}
 console.log('PASS actual Library assignment API, additive memberships, group/legacy compatibility, listings, filters, counts and atomic account boundaries');
}finally{server?.close();await pool.end();}})().catch(e=>{console.error(e);process.exitCode=1});

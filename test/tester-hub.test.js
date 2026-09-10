const test=require('node:test'),assert=require('node:assert/strict');
const url=process.env.TESTER_HUB_DATABASE_URL;
test('Testing Hub administration, isolation, badge and retest lifecycle',{skip:!url},async()=>{
  const target=new URL(url);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.pathname,'/pn_tester_hub_test');
  Object.assign(process.env,{DATABASE_URL:url,SESSION_SECRET:'local-tester-hub-test-secret',ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD:'local-test-password',PGSSL:''});
  const {pool,init}=require('../db');await init();const {app}=require('../server');const server=app.listen(0);await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`,{chromium}=require('playwright');let browser;
  const login=async email=>{const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'local-test-password'})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]};
  const call=async(cookie,path,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}};
  try{
    const admin=await login('admin@example.test');
    const hash=await require('bcryptjs').hash('local-test-password',4);
    const ids=[];for(const name of ['alpha','beta'])ids.push((await pool.query("INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id",[name+' Tester',name+'@example.test',hash])).rows[0].id);
    const a=await login('alpha@example.test'),b=await login('beta@example.test');
    assert.equal((await call(a,`/api/admin/users/${ids[0]}`,{is_tester:true})).status,403);
    assert.equal((await call(admin,`/api/admin/users/${ids[0]}`,{is_tester:true})).status,200);
    assert.equal((await call(a,'/api/me')).data.is_tester,true);
    const reports=[];for(const id of ids)reports.push((await pool.query("INSERT INTO issue_reports(user_id,description,management_status,verification,release_reference,retest_instructions) VALUES($1,$2,'ready_to_test','{}','test-release','Repeat the test') RETURNING id",[id,id===ids[0]?'My private report':'Other private report'])).rows[0].id);
    assert.deepEqual((await call(a,'/api/issues/mine')).data.map(r=>r.id),[reports[0]]);
    assert.equal((await call(a,`/api/issues/${reports[1]}/history`)).status,404);
    assert.equal((await call(a,`/api/issues/${reports[1]}/retest`,{result:'fixed'})).status,404);
    assert.equal((await call(a,'/api/issues/attention')).data.ready_count,1);
    assert.equal((await call(b,'/api/issues/attention')).data.ready_count,0);
    browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.addCookies([{name:'pn_token',value:a.slice('pn_token='.length),url:base}]);const page=await context.newPage();await page.goto(base,{waitUntil:'domcontentloaded'});
    await page.locator('#testerAlert').waitFor({state:'visible'});await page.locator('#profileButton').click();assert.equal(await page.locator('#myIssues').innerText(),'Testing Hub');await page.locator('#myIssues').click();await page.getByText('My private report',{exact:true}).waitFor();assert.equal(await page.getByText('Other private report',{exact:true}).count(),0);
    await page.getByRole('button',{name:'Fixed on my device',exact:true}).click();await page.getByText('Closed - you confirmed',{exact:true}).waitFor();await page.locator('#testerAlert').waitFor({state:'hidden'});
    assert.equal((await call(a,'/api/issues/attention')).data.ready_count,0);
    await pool.query("UPDATE issue_reports SET management_status='ready_to_test' WHERE id=$1",[reports[0]]);
    assert.equal((await call(a,'/api/issues/attention')).data.ready_count,1);
    assert.equal((await call(a,`/api/issues/${reports[0]}/retest`,{result:'still_happening',notes:'Still broken'})).status,200);
    assert.equal((await call(a,'/api/issues/attention')).data.ready_count,0);
    await call(admin,`/api/admin/users/${ids[0]}`,{is_tester:false});assert.equal((await call(a,'/api/me')).data.is_tester,false);
    const ac=await browser.newContext({viewport:{width:390,height:844}});await ac.addCookies([{name:'pn_token',value:admin.slice('pn_token='.length),url:base}]);const ap=await ac.newPage();await ap.goto(base+'/admin');await ap.locator(`[data-open-user="${ids[0]}"]`).click();assert.equal(await ap.getByRole('button',{name:'Advanced Features',exact:true}).count(),0);await ap.locator('[data-tester]').check();await ap.getByRole('button',{name:'Save Tester Access',exact:true}).click();await ap.getByText('Tester access saved',{exact:true}).waitFor();assert.equal((await call(a,'/api/me')).data.is_tester,true);await ap.getByRole('button',{name:'Save Versions',exact:true}).waitFor();
    assert.ok(await ap.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await ap.screenshot({path:'/tmp/pn-tester-admin.png',fullPage:true});
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));await pool.end();}
});

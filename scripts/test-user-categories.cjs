const assert=require('node:assert/strict'),express=require('express');
const {chromium,webkit}=require('playwright');
(async()=>{
 const app=express();app.use(express.static(require('node:path').join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[],writes=[];
  const users=[{id:1,name:'Owner Account',email:'owner@example.invalid',role:'admin',is_super_admin:true,user_category:'development_testing',active:true,edition_access:['basic']},{id:2,name:'External Tester',email:'tester@example.invalid',user_category:'user_testers',active:true,edition_access:['basic']}];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>{
   const req=route.request(),p=new URL(req.url()).pathname;let data=[];
   if(p==='/api/me')data={...users[0],plan:'pro'};
   if(p==='/api/admin/users')data=users;
   if(req.method()==='POST'&&/^\/api\/admin\/users/.test(p)){const body=req.postDataJSON();writes.push({p,body});if(p.endsWith('/1'))Object.assign(users[0],body);data={ok:true};}
   if(p==='/api/issues/attention')data={count:0};
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/admin.html?view=super`);
  await page.locator('#usersHeading').click();await page.locator('[data-open-user="1"]').waitFor();
  await page.locator('#categoryFilter').selectOption('development_testing');assert.equal(await page.locator('[data-open-user]').count(),1);
  await page.locator('#categoryFilter').selectOption('customers');assert.equal(await page.locator('[data-open-user]').count(),0);
  await page.locator('#categoryFilter').selectOption('');
  await page.locator('#addUser').click();assert.deepEqual(await page.locator('#ccategory option').allTextContents(),['Development & Testing','User Testers','Customers']);
  await page.locator('#cname').fill('New Customer');await page.locator('#cemail').fill('new@example.invalid');await page.locator('#cpass').fill('fixture-password');await page.locator('#ccategory').selectOption('customers');await page.locator('#createbtn').click();await page.waitForFunction(()=>document.querySelector('#createUserPanel').hidden);
  assert.equal(writes[0].body.user_category,'customers');
  await page.locator('[data-open-user="1"]').click();await page.locator('[data-edit-user]').click();assert.equal(await page.locator('#edit-category-1').inputValue(),'development_testing');
  await page.locator('#edit-category-1').selectOption('customers');await page.locator('[data-save-user]').click();await page.waitForFunction(()=>document.querySelector('#edit-user-1')?.hidden===true);assert.equal(writes[1].body.user_category,'customers');
  assert.deepEqual(errors,[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log(engine.name(),width,'category create/edit/filter PASS');await page.close();
 }}finally{await browser.close();}}}finally{server.close();}
})().catch(e=>{console.error(e);process.exit(1)});

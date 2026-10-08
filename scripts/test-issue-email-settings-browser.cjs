const assert=require('node:assert/strict'),express=require('express');
const {chromium,webkit}=require('playwright');
(async()=>{
 const app=express();app.use(express.static(require('node:path').join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const engine of [chromium,webkit]){
  const browser=await engine.launch();
  try{for(const width of [390,1440]){for(const owner of [true,false]){
   const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   let settings={email_notifications_enabled:true,email_reminders_enabled:true,email_interval_minutes:240},posts=0;
   await page.route('**/api/**',route=>{
    const p=new URL(route.request().url()).pathname;
    if(p==='/api/admin/issues/notification-settings'&&route.request().method()==='POST'){posts++;settings=route.request().postDataJSON();}
    const data=p==='/api/me'?{id:1,name:'Fixture',role:owner?'admin':'user',is_testing_manager:!owner,is_super_admin:owner,plan:'pro'}:p==='/api/admin/issues/notification-settings'?settings:[];
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   });
   page.setDefaultTimeout(15000);
   await page.goto('http://127.0.0.1:'+server.address().port+'/admin.html?tool=issues');
   await page.waitForFunction(()=>typeof allIssues!=='undefined',{},{timeout:15000});
   if(owner){
    await page.locator('#issueEmailSettings > summary').click();
    await page.waitForFunction(()=>!document.getElementById('saveIssueEmailSettings').disabled,{},{timeout:15000});
    assert.equal(await page.locator('#issueEmailReminderHours').inputValue(),'4');
    await page.locator('#issueEmailReminderHours').fill('0.5');
    await page.locator('#saveIssueEmailSettings').click();
    await page.waitForFunction(()=>document.getElementById('issueEmailSettingsResult').textContent.startsWith('Saved.'),{},{timeout:15000});
    assert.equal(settings.email_interval_minutes,30);assert.equal(settings.email_notifications_enabled,true);
    await page.locator('#issueEmailNotificationsEnabled').uncheck();
    await page.locator('#issueEmailRemindersEnabled').uncheck();await page.locator('#saveIssueEmailSettings').click();
    await page.waitForFunction(()=>document.getElementById('issueEmailSettingsResult').textContent.includes('emails are off'),{},{timeout:15000});
    assert.equal(settings.email_reminders_enabled,false);assert.equal(posts,2);assert.equal(settings.email_notifications_enabled,false);
    await page.reload();await page.locator('#issueEmailSettings > summary').click();
    await page.waitForFunction(()=>!document.getElementById('saveIssueEmailSettings').disabled,{},{timeout:15000});
    assert.equal(await page.locator('#issueEmailRemindersEnabled').isChecked(),false);assert.equal(await page.locator('#issueEmailNotificationsEnabled').isChecked(),false);
    assert.equal(await page.locator('#issueEmailReminderHours').inputValue(),'0.5');
    await page.locator('.pn-help-fab').click();
    await page.waitForFunction(()=>document.querySelector('#photoNotesHelp')?.textContent.includes('Only the Super Admin'),{},{timeout:15000});
   }else{assert.equal(await page.locator('#issueEmailSettings').count(),0);assert.equal(posts,0);}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
   console.log(`${engine.name()} ${width}: ${owner?'owner saves settings and Help':'manager cannot see settings'} PASS`);await page.close();
  }}}finally{await browser.close();}
 }}finally{server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

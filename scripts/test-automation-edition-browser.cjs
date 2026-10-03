'use strict';
const assert=require('node:assert/strict'),express=require('express'),path=require('node:path'),fs=require('node:fs/promises');
const {chromium,webkit}=require('playwright');const {editionIds,user}=require('../test/support/factories.cjs');
(async()=>{const app=express();app.use(express.static(path.join(__dirname,'../public')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const output=path.join(__dirname,'../output/automated-testing/screenshots');await fs.mkdir(output,{recursive:true});const audit=[];
 try{for(const [device,engine,viewport] of [['iphone',webkit,{width:390,height:844}],['android',chromium,{width:412,height:915}],['tablet',chromium,{width:768,height:1024}],['desktop',chromium,{width:1440,height:1000}]]){
  const browser=await engine.launch();try{for(const edition of editionIds){const context=await browser.newContext({viewport,serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage();const errors=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
   await page.route('**/*',route=>{const url=new URL(route.request().url());if(!['localhost','127.0.0.1'].includes(url.hostname))return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();const p=url.pathname;const data=p==='/api/me'?user(edition):p==='/api/config'?{}:p==='/api/billing/config'?{checkout_enabled:false}:p==='/api/hoa/context'?{communities:[],members:[]}:[];return route.fulfill({json:data});});
   await page.addInitScript(()=>localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed'));
   await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>typeof state!=='undefined'&&state.me&&document.getElementById('body'));
   if(edition==='basic'){for(const id of ['tabOrganize','tabEdit','tabCreate','tabSend'])assert.equal(await page.locator('#'+id+':visible').count(),0,device+' Basic excludes '+id);assert.equal(await page.locator('#photoLib').count(),1,device+' Basic photo input');}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,edition+' '+device+' viewport fit');
   const issues=await page.evaluate(()=>[...document.querySelectorAll('button,input,select,textarea')].filter(n=>n.getClientRects().length&&!n.disabled&&n.type!=='hidden').flatMap(n=>{const name=n.getAttribute('aria-label')||n.getAttribute('title')||(n.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim()||(n.labels&&[...n.labels].map(l=>l.textContent).join(' '))||(['BUTTON','SELECT'].includes(n.tagName)?n.textContent.trim():'')||n.getAttribute('placeholder');return name?[]:[{id:n.id,tag:n.tagName,problem:'missing accessible name'}];}));
   audit.push({edition,device,issues});
   await page.locator('#issueFab').click();await page.locator('#issueModal').waitFor({state:'visible'});assert.equal(await page.locator('#issueFab').isVisible(),false,edition+' '+device+' floating Report Issue must not cover dialog actions');await page.locator('#issueSend').scrollIntoViewIfNeeded();assert(await page.locator('#issueSend').evaluate(n=>{const box=n.getBoundingClientRect();return n.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));}),edition+' '+device+' Send Issue Report receives pointer events');await page.locator('#issueClose').click();assert(await page.locator('#issueFab').isVisible(),edition+' '+device+' Report Issue returns after dismissal');
   await page.screenshot({path:path.join(output,edition+'-'+device+'.png'),fullPage:true,animations:'disabled'});assert.deepEqual(errors,[],edition+' '+device+' JavaScript errors');
   await context.close();console.log('PASS '+edition+' '+device+' load, gates, viewport and console');
  }}finally{await browser.close();}
 }}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.writeFile(path.join(output,'interaction-audit.json'),JSON.stringify(audit,null,2));}
 // Keep diagnostics explicit. Existing inaccessible controls must block readiness.
 assert.deepEqual(audit.filter(row=>row.issues.length),[],'visible controls require accessible names; see interaction-audit.json');
})().catch(e=>{console.error(e);process.exitCode=1;});

const express=require('express'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium,webkit}=require('playwright');
(async()=>{const app=express();app.use(express.static(path.join(__dirname,'../public')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [320,390,1440]){const page=await browser.newPage({viewport:{width,height:850},serviceWorkers:'block'});
await page.route('**/api/**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/me'?{id:1,name:'Fixture',role:'admin',plan:'pro',pro_type:'general',edition_access:['pro']}:[]}));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>state.me);
for(const edition of ['basic','issue','roads','general','contractor','paving','hoa','property','concrete','roofer']){for(const view of ['capture','organize','edit','create','send']){
await page.evaluate(({edition,view})=>{window.scrollTo(0,0);state.plan=['basic','issue','roads'].includes(edition)?'free':'pro';state.proType=edition==='basic'?'general':edition;state.view=view;renderApp();}, {edition,view});
const nav=page.locator('.workflow-tabs');if(await page.evaluate(()=>isBasicClient()||isRoadIssuesClient())){assert.equal(await nav.count(),0);continue;}await nav.waitFor();assert.equal(await nav.locator('button').count(),5);
await page.evaluate(()=>{const filler=document.createElement('div');filler.style.height='3000px';document.querySelector('.wrap').append(filler);window.scrollTo(0,700)});await page.waitForTimeout(30);
const bounds=await nav.boundingBox();assert(bounds.y>=-1&&bounds.y<45,`${engine.name()} ${width} ${edition} ${view}: sticky menu at top`);assert.equal(await page.locator('.app-header').evaluate(e=>e.getBoundingClientRect().bottom<0),true,'header scrolls away');
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');
assert.equal(await nav.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}),true,'menu remains clickable above content');
if(edition==='property'&&view==='organize'){await page.screenshot({path:`/tmp/pn-sticky-${engine.name()}-${width}.png`});await page.locator('#issueFab').click();await page.locator('.issue-dialog').waitFor();assert.equal(await page.evaluate(()=>{const d=document.querySelector('.issue-dialog'),r=d.getBoundingClientRect();return d.contains(document.elementFromPoint(r.x+r.width/2,r.y+20))}),true,'report dialog above sticky menu');await page.locator('#issueClose').click();}
await page.locator('#tabCapture').click();assert.equal(await page.locator('#tabCapture').getAttribute('aria-current'),'page');
}}
console.log(engine.name(),width,'all editions/screens sticky menu PASS');await page.close();}}finally{await browser.close();}}}finally{await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1});

'use strict';
const express=require('express'),{chromium,webkit}=require('playwright'),assert=require('node:assert/strict');
const photo={id:1,photo_path:'/logo.svg',photo_title:'Pavement photo',note:'Field observation',kind:'note',area_tags:[],created_at:new Date().toISOString(),overlays:[]};
(async()=>{const app=express();app.use(express.static(require('node:path').join(__dirname,'../public')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [390,1440]){const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',r=>{const p=new URL(r.request().url()).pathname;let d=[];
if(p==='/api/me')d={id:1,name:'Owner',role:'user',plan:'pro',pro_type:'general',edition_access:['pro']};
else if(p==='/api/captures'||p==='/api/captures/search')d=[photo];
else if(p.endsWith('/comments'))d={capture:photo,context:'Test Job',comments:[{id:1,author_name:'Sam',text:'Get an overview photo',created_at:photo.created_at}],members:[]};
else if(p==='/api/billing/config')d={checkout_enabled:false};
return r.fulfill({json:d});});
await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>state.me&&document.getElementById('body'));
for(const edition of ['general','paving','concrete','property','hoa','contractor','roofer']){
await page.evaluate(edition=>{state.plan='pro';state.proType=edition;state.view='edit';renderApp();},edition);
await page.locator('#cards [data-comments-id="1"]').waitFor();assert.equal(await page.locator('#cards [data-comments-id="1"]').count(),1);
await page.locator('#cards [data-comments-id="1"]').click();await page.getByText('Get an overview photo',{exact:true}).waitFor();assert(await page.getByRole('dialog',{name:'Internal Discussion'}).isVisible());assert(await page.getByText('Test Job',{exact:true}).isVisible());
await page.getByRole('button',{name:'Back to Photo'}).click();assert(await page.locator('#cards img').isVisible());
}
assert.deepEqual(errors,[]);await page.close();console.log(`${engine.name()} ${width}: actual app Comments entry and photo return pass in all 7 Pro editions`);
}}finally{await browser.close();}}}finally{server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

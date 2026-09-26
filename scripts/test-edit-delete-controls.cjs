const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const express=require('express');
(async()=>{
 const app=express();app.use(express.static(require('node:path').join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'});
 let rows=[{id:1,note:'First',area_tags:['A']},{id:2,note:'Second',area_tags:['B']}],writes=[],fail=false;
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());let data=[];
  if(url.pathname==='/api/me')data={id:1,name:'Test',plan:'pro',pro_type:'paving',role:'user'};
  if(url.pathname==='/api/areas')data=['A','B'];
  if(url.pathname==='/api/captures')data=rows.filter(r=>!url.searchParams.get('area')||r.area_tags.includes(url.searchParams.get('area')));
  if(url.pathname==='/api/captures/delete'){
   const ids=route.request().postDataJSON().ids;writes.push(ids);
   if(fail)return route.fulfill({status:500,body:'{}'});
   rows=rows.filter(r=>!ids.includes(String(r.id)));data={ok:true,deleted:ids.length};
  }
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.locator('#tabEdit').click();await page.locator('.capchk').first().waitFor();
 assert.equal(await page.locator('.workflow-edit .workflow-intro').count(),0);
 assert.equal(await page.locator('#fixaddr').count(),0);
 assert.equal(await page.locator('label[for="filter"]').innerText(),'FILTER');
 assert.deepEqual(await page.locator('#delbtn, #delall').allTextContents(),['Delete Selected','Delete All']);
 await page.locator('#selall').click();assert.equal(await page.locator('.capchk:checked').count(),2);
 await page.locator('#selnone').click();assert.equal(await page.locator('.capchk:checked').count(),0);
 await page.selectOption('#filter','A');await page.waitForFunction(()=>document.querySelectorAll('.capchk').length===1);
 page.once('dialog',async d=>{assert.match(d.message(),/hidden by the current filter/);assert.match(d.message(),/Captures to delete: 2/);await d.dismiss();});
 await page.locator('#delall').click();await page.waitForFunction(()=>!document.getElementById('delall').disabled);assert.equal(writes.length,0);
 await page.locator('.capchk').check();page.once('dialog',d=>d.accept());await page.locator('#delbtn').click();await page.waitForFunction(()=>!document.getElementById('delbtn').disabled);assert.deepEqual(writes[0],['1']);
 fail=true;page.once('dialog',d=>d.accept());await page.locator('#delall').click();await page.waitForFunction(()=>!document.getElementById('delall').disabled);assert.equal(rows.length,1);
 fail=false;page.once('dialog',d=>d.accept());await page.locator('#delall').click();await page.waitForFunction(()=>!document.getElementById('delall').disabled);assert.deepEqual(writes.at(-1),['2']);assert.equal(rows.length,0);
 await page.locator('#delall').click();await page.waitForFunction(()=>!document.getElementById('delall').disabled);assert.equal(writes.length,3);
 await page.screenshot({path:`/tmp/pn-edit-${engine.name()}-${width}.png`});
 await page.close();console.log(engine.name(),width,'PASS');
 }}finally{await browser.close();}}}finally{server.close();}
})().catch(e=>{console.error(e);process.exit(1);});

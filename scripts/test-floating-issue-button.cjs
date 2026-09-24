const assert=require('node:assert/strict'),express=require('express'),{chromium,webkit}=require('playwright');
(async()=>{
 const app=express();app.use(express.static(require('node:path').join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const engine of [chromium,webkit]){
  const browser=await engine.launch();try{for(const width of [360,390,768,1100,1440]){
   const page=await browser.newPage({viewport:{width,height:844},serviceWorkers:'block'});
   await page.route('**/api/**',route=>{const pathname=new URL(route.request().url()).pathname;return route.fulfill({contentType:'application/json',body:JSON.stringify(pathname==='/api/me'?{id:1,name:'Owner',role:'admin',is_super_admin:true,plan:'pro',pro_type:'general',edition_access:['pro']}:pathname==='/api/issues/attention'?{count:0}:[])});});
   for(const path of ['/','/admin.html']){
    await page.goto('http://127.0.0.1:'+server.address().port+path);await page.locator('#issueFab').waitFor();
    await page.evaluate(()=>{const spacer=document.createElement('div');spacer.style.height='12000px';document.body.append(spacer);});
    for(const theme of ['light','dark']){
     await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
     for(const y of [0,6000,12000]){
      await page.evaluate(y=>window.scrollTo(0,y),y);
      const position=await page.locator('#issueFab').evaluate(el=>{const r=el.getBoundingClientRect();return {position:getComputedStyle(el).position,right:innerWidth-r.right,bottom:innerHeight-r.bottom,top:r.top,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.id};});
      assert.equal(position.position,'fixed');assert(position.right>=13&&position.right<=15);assert(position.bottom>=13&&position.bottom<=15);assert(position.top>0);assert.equal(position.hit,'issueFab',JSON.stringify({engine:engine.name(),width,path,theme,y,position}));
     }
    }
   }
   await page.close();console.log(engine.name(),width,'app/admin, both themes, three scroll positions PASS');
  }}finally{await browser.close();}
 }}finally{server.close();}
})().catch(e=>{console.error(e);process.exit(1)});

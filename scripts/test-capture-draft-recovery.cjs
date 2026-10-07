const assert=require('node:assert/strict'),express=require('express');
const {chromium,webkit}=require('playwright');
(async()=>{
 const app=express();app.use(express.static(require('node:path').join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const engine of [chromium,webkit]){
 const browser=await engine.launch();try{for(const width of [390,1440])for(const edition of ['basic','pro','contractor','roads','paving','hoa','property','concrete','roofer','issue']){
 const page=await browser.newPage({viewport:{width,height:844},serviceWorkers:'block'});
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(path==='/api/me'?{id:1,email:'draft@example.com',plan:['basic','roads','issue'].includes(edition)?'free':'pro',pro_type:edition==='pro'?'general':edition,edition,edition_access:[edition]}:[])});});
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.waitForFunction(()=>state.me?.email&&document.querySelector('#body'));
 assert.equal(await page.evaluate(()=>selectedEdition()),edition);
 // Exercise the shared real capture entry point, including recovery with no note.
 await page.evaluate(async()=>{state.view='capture';renderApp();onPhotoChosen(new File(['irreplaceable-photo'],'original.jpg',{type:'image/jpeg'}));await captureDraftWrites;});
 await page.reload();await page.waitForFunction(()=>state.photoFile);
 assert.equal(await page.evaluate(()=>state.photoFile.text()),'irreplaceable-photo');
 await page.evaluate(async()=>{state._note='Add this later';await persistCaptureDraft();});
 await page.reload();await page.waitForFunction(()=>state.photoFile);
 assert.equal(await page.evaluate(()=>state._note),'Add this later');
 await page.evaluate(async()=>{cancelCapturePhoto();await captureDraftWrites;});
 await page.reload();await page.waitForFunction(()=>state.me?.email&&document.querySelector('#body'));assert.equal(await page.evaluate(()=>!!state.photoFile),false);
 await page.close();console.log(engine.name(),width,edition,'PASS');
 }}finally{await browser.close();}}
 }finally{server.close();}
})().catch(e=>{console.error(e);process.exit(1);});

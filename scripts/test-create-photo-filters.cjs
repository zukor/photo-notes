const assert=require('node:assert/strict'),express=require('express'),path=require('node:path');
const {chromium,webkit}=require('playwright');
(async()=>{
 const app=express();app.use(express.static(path.join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const photos=[
  {id:1,photo_path:'/icon-192.png',photo_title:'Old road',area_tags:['Older topic'],job_id:7,job_name:'North job'},
  {id:2,photo_path:'/icon-192.png',photo_title:'New road',area_tags:['New topic'],job_id:7,job_name:'North job'},
  {id:3,photo_path:'/icon-192.png',photo_title:'Old wall',area_tags:['Older topic'],job_id:8,job_name:'South job'},
  {id:4,photo_path:'/icon-192.png',photo_title:'Other',area_tags:[],job_id:null},
 ];
 try{for(const engine of [chromium,webkit]){
  const browser=await engine.launch();try{for(const width of [390,1440]){
   const page=await browser.newPage({viewport:{width,height:950},serviceWorkers:'block'});
   await page.route('**/api/**',r=>{const p=new URL(r.request().url()).pathname;return r.fulfill({json:p==='/api/me'?{id:1,plan:'pro',pro_type:'general'}:p==='/api/captures'?photos:[]});});
   await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>typeof state!=='undefined'&&state.me&&document.getElementById('body'));
   for(const edition of ['general','contractor','paving','concrete','hoa','property','roofer','basic','issue','roads']){
    await page.evaluate(async edition=>{state.plan=['basic','issue','roads'].includes(edition)?'free':'pro';state.proType=edition==='basic'?'general':edition;state.selectedIds=new Set();newDocumentPhotoIds.clear();newDocumentPhotoTopic='';newDocumentPhotoJob='';await renderNewDocumentPhotos();},edition);
    assert(await page.locator('#newDocumentTopic option').allTextContents().then(t=>t.includes('Older topic')));
    await page.locator('[data-document-source-photo="4"]').check();
    await page.locator('#newDocumentTopic').selectOption('Older topic');await page.locator('#newDocumentJob').selectOption('7');
    assert.deepEqual(await page.locator('[data-document-source-photo]').evaluateAll(n=>n.map(x=>x.dataset.documentSourcePhoto)),['1']);
    await page.locator('#selectAllDocumentPhotos').click();assert.deepEqual(await page.evaluate(()=>[...newDocumentPhotoIds].sort()),['1','4']);
    await page.locator('#newDocumentPhotoSearch').fill('wall');assert.equal(await page.locator('[data-document-source-photo]').count(),0);
    await page.locator('#newDocumentJob').selectOption('8');assert.equal(await page.locator('[data-document-source-photo="3"]').count(),1);
    await page.locator('#newDocumentPhotoSearch').fill('');await page.locator('#newDocumentTopic').selectOption('');await page.locator('#newDocumentJob').selectOption('');
    assert(await page.locator('[data-document-source-photo="1"]').isChecked());assert(await page.locator('[data-document-source-photo="4"]').isChecked());
    assert(await page.locator('#body').evaluate(e=>e.scrollWidth<=innerWidth));
    await page.locator('#clearDocumentPhotos').click();assert.equal(await page.evaluate(()=>newDocumentPhotoIds.size),0);assert(await page.locator('#gcreate').isDisabled());
   }
   console.log(engine.name(),width,'all ten editions: saved topics/jobs, combined filters and preserved selections PASS');await page.close();
  }}finally{await browser.close();}
 }}finally{server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

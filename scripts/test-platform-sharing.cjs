const assert=require('node:assert/strict'),{chromium,webkit}=require('playwright'),express=require('express');
(async()=>{const app=express();app.use(express.static(require('node:path').join(__dirname,'../public')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let cases=0;
try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const edition of ['general','contractor','paving','concrete','hoa','roofer'])for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block',userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/154.0.0.0 Safari/537.36'});page.setDefaultTimeout(10000);const exports=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed');localStorage.setItem('pn_first_use_v1:'+encodeURIComponent('test@example.invalid'),'done');});
 await page.route('**/api/**',route=>{const u=new URL(route.request().url()),p=u.pathname;let data=[];
 if(p==='/api/me')data={id:1,email:'test@example.invalid',plan:'pro',pro_type:edition,role:'user',ramo_intake_access:true};
 if(p==='/api/captures')data=[{id:1,photo_title:'Test photo',note:'Test note',area_tags:[]}];if(p==='/api/groups')data=[{id:2,title:'Test document',item_count:1}];
 if(p.startsWith('/api/export/')){exports.push(u.pathname+u.search);return route.fulfill({contentType:p.endsWith('/pdf')?'application/pdf':p.endsWith('/docx')?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/zip',body:'synthetic export'});}
 if(p==='/api/document-links'&&route.request().method()==='POST')data={path:'/shared-document/synthetic',filename:'Test document',expires_at:'2030-01-01T00:00:00Z'};
 return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('#profileButton').waitFor();await page.evaluate(()=>{state.view='send';state.selectedIds=new Set(['1']);renderApp();navigator.canShare=()=>true;navigator.share=async()=>{throw new DOMException('Unavailable','NotAllowedError');};downloadBlob=(file,name)=>window.lastDownload=name;});await page.locator('#documentFormat2').waitFor();
 assert(await page.locator('#shareOriginalPhotos').isVisible());assert.equal(await page.locator('#sendToRamo').count(),edition==='concrete'?1:0);
 for(const group of [false,true])for(const format of ['pdf','docx','bundle']){
  await page.locator(group?'#documentFormat2':'#sendformat').selectOption(format);await page.locator(group?'[data-document-action="share"]':'#sharephotos').click();await page.locator('#exportShareDialog').waitFor();assert.match(exports.at(-1),new RegExp('/api/export/'+format+'\\?'+(group?'group=2':'ids=1')));
  const share=page.locator('[data-share-open]');assert.equal(await share.isVisible(),format==='pdf');if(format==='pdf'){await share.click();assert.match(await page.locator('[data-share-status]').textContent(),/could not share/);}
  await page.getByRole('button',{name:'Create share link',exact:true}).click();await page.locator('.document-link-panel input').waitFor();assert.match(await page.locator('.document-link-panel input').inputValue(),/shared-document\/synthetic/);
  assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
  if(engine===chromium&&edition==='general'&&width===390&&!group&&format==='pdf')await page.screenshot({path:'/tmp/tester-sharing-mobile.png'});
  await page.locator('[data-share-download]').click();assert.match(await page.evaluate(()=>lastDownload),new RegExp('\\.'+(format==='bundle'?'zip':format)+'$'));cases++;
 }
 assert.deepEqual(errors,[]);await page.close();console.log(engine.name(),edition,width,'selected and saved-document format sharing passed');
 }}finally{await browser.close();}}console.log(`${cases} document sharing checks passed`);}finally{server.close();}})().catch(e=>{console.error(e);process.exitCode=1});

'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true});try{
for(const edition of ['general','paving','concrete','property','hoa','contractor','roofer','basic','issue','roads'])for(const width of [390,1440]){
const page=await browser.newPage({viewport:{width,height:900}});let comments=[{id:1,author_id:2,author_name:'Sam',text:'Show the entire area',created_at:new Date().toISOString(),can_edit:false,can_delete:false}];let fail=false;
await page.route('http://comments.test/**',route=>{
const req=route.request();if(req.url().endsWith('/photo.jpg'))return route.fulfill({body:fs.readFileSync('public/logo.svg'),contentType:'image/svg+xml'});if(req.url().endsWith('/comments')&&req.method()==='GET')return route.fulfill({json:{capture:{id:1,photo_path:'/photo.jpg',photo_title:'Damaged pavement',created_at:new Date().toISOString()},context:'Job 123 / North parking lot',comments,members:[{id:2,name:'Sam'}]}});
if(req.method()==='POST'){if(fail)return route.fulfill({status:503,json:{error:'Could not save. Keep your draft.'}});const b=req.postDataJSON();comments.push({id:2,author_name:'Owner',text:b.text,reply_to:b.reply_to,created_at:new Date().toISOString(),can_edit:true,can_delete:true});return route.fulfill({json:{ok:true}});}
if(['PATCH','DELETE'].includes(req.method())){const c=comments.find(c=>c.id===Number(req.url().split('/').at(-1)));if(req.method()==='PATCH'){c.text=req.postDataJSON().text;c.edited_at=new Date().toISOString();}else{c.deleted_at=new Date().toISOString();c.text='';c.can_edit=false;c.can_delete=false;}return route.fulfill({json:{ok:true}});}
return route.fulfill({body:'<!doctype html><div id="app"><div class="card"><img src="/photo.jpg" alt="Photo"><div class="phototitlewrap" data-id="1">Photo Note</div></div></div>',contentType:'text/html'});
});
await page.goto('http://comments.test/');await page.addStyleTag({content:fs.readFileSync('public/photo-comments.css','utf8')});
await page.addScriptTag({content:`let state={plan:${JSON.stringify(edition==='basic'?'free':'pro')},proType:${JSON.stringify(edition)}};function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}`});
await page.addScriptTag({path:'public/help-catalog.js'});await page.addStyleTag({path:'public/help.css'});await page.addScriptTag({path:'public/help.js'});
await page.addScriptTag({path:'public/photo-comments.js'});
await page.evaluate(()=>document.querySelector('#app').append(document.createElement('p')));
if(['basic','issue','roads'].includes(edition)){assert.equal(await page.locator('[data-comments-id]').count(),0);await page.close();continue;}
await page.getByRole('button',{name:'Comments',exact:true}).click();await page.getByText('Damaged pavement').waitFor();
await page.locator('.pn-help-fab').click();await page.locator('#pnHelpSearch').fill('Comments');assert(await page.locator('.pn-help-article').count()>0);await page.locator('#pnHelpClose').click();await page.waitForFunction(()=>getComputedStyle(document.querySelector('.pn-help-drawer')).visibility==='hidden');
assert.equal(await page.evaluate(()=>document.querySelector('.comments-panel').scrollWidth<=document.querySelector('.comments-panel').clientWidth),true);
if(edition==='general')await page.screenshot({path:'/tmp/photo-comments-'+width+'.png'});
assert.equal(await page.locator('#commentsText').evaluate(n=>getComputedStyle(n).color),'rgb(0, 0, 0)');
await page.getByRole('button',{name:'Reply',exact:true}).click();await page.locator('#commentsText').fill('This afternoon');fail=true;await page.getByRole('button',{name:'Post Comment',exact:true}).click();await page.getByText('Could not save. Keep your draft.').waitFor();assert.equal(await page.locator('#commentsText').inputValue(),'This afternoon');
await page.getByRole('button',{name:'Back to Photo'}).click();await page.getByRole('button',{name:'Comments',exact:true}).click();await page.getByText('Damaged pavement').waitFor();assert.equal(await page.locator('#commentsText').inputValue(),'This afternoon');
fail=false;await page.getByRole('button',{name:'Post Comment',exact:true}).click();await page.getByText('This afternoon',{exact:true}).waitFor();assert.equal(await page.locator('#commentsText').inputValue(),'');assert.equal(comments.at(-1).reply_to,1);
await page.getByRole('button',{name:'Edit',exact:true}).click();assert.equal(await page.locator('#commentsText').inputValue(),'This afternoon');await page.locator('#commentsText').fill('Updated response');await page.getByRole('button',{name:'Save Edit',exact:true}).click();await page.getByText('Updated response',{exact:true}).waitFor();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Delete',exact:true}).click();await page.getByText('Comment deleted',{exact:true}).waitFor();
await page.locator('#commentsMention').selectOption('Sam');assert.equal(await page.locator('#commentsText').inputValue(),'@Sam ');
await page.context().setOffline(true);await page.getByRole('button',{name:'Post Comment',exact:true}).click();await page.getByText('Offline. Your draft is kept here. Retry when connected.').waitFor();assert.equal(await page.locator('#commentsText').inputValue(),'@Sam ');await page.context().setOffline(false);
await page.close();
}
console.log('Comments browser passed: all 7 enabled and 3 excluded editions at phone/desktop widths, context, black text, replies, failed/offline drafts, reopen, mentions.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

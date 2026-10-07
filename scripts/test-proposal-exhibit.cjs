// Browser fixtures use no production data or external providers.
const express = require('express');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {chromium, webkit} = require('playwright');
const editions = ['general', 'contractor', 'paving', 'asphalt', 'concrete', 'hoa', 'property', 'roofer'];
const note = 'Observed existing surface and proposed repair area. '.repeat(180) + 'END OF COMPLETE NOTE';
const image = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#fff"/><rect x="20" y="20" width="560" height="360" fill="#bdc7a5"/><path d="M20 320L580 140" stroke="#000" stroke-width="25"/><text x="30" y="60" font-family="Arial" font-size="24" fill="black">Proposal exhibit test photograph</text></svg>';
const output = path.join(__dirname, '../output/proposal-exhibit-qa');
(async () => {
 fs.mkdirSync(output, {recursive:true});
 const app = express();
 app.get('/uploads/exhibit-test.svg', (_req, res) => res.type('svg').send(image));
 app.use(express.static(path.join(__dirname, '../public')));
 const server = app.listen(0, '127.0.0.1');
 await new Promise(resolve => server.once('listening', resolve));
 try {
  for (const engine of [chromium, webkit]) {
   const browser = await engine.launch();
   try {
    for (const width of [390, 1440]) {
     const page = await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'});
     let fixtureNote=note;
     const errors=[];page.on('pageerror',error=>errors.push(error.message));
     await page.addInitScript(()=>{localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed');localStorage.setItem('pn_first_use_v1:','done');});
     await page.route('**/api/**', route => {
      const url = new URL(route.request().url());
      let data=[];
      if(url.pathname==='/api/me')data={id:1,name:'Exhibit Tester',role:'user',plan:'pro',pro_type:'general',edition_access:['pro']};
      if(url.pathname==='/api/groups/42')data={group:{id:42,title:'Exhibit A Site Conditions'},items:[{id:1,photo_path:'/uploads/exhibit-test.svg',photo_title:'Existing Surface',note:fixtureNote,address:'Test site address',latitude:12,longitude:34,created_at:'2026-10-07T10:00:00Z',area_tags:['Proposal'],comments:[{text:'PRIVATE COMMENT'}]},{id:2,photo_title:'Second photo note',note:'Second note'}],pairs:[]};
      if(url.pathname==='/api/document-settings')data={branding:{}};
      if(url.pathname==='/api/billing/config')data={checkout_enabled:false};
      return route.fulfill({json:data});
     });
     await page.goto(`http://127.0.0.1:${server.address().port}`);
     await page.waitForFunction(()=>typeof state!=='undefined'&&state.me&&document.getElementById('body'));
     await page.waitForFunction(()=>document.getElementById('body').children.length>0);
     for(const edition of editions){
      fixtureNote=edition==='general'?note:'Observed site condition for '+edition;
      await page.evaluate(()=>localStorage.removeItem('proposal-exhibit:1:42'));
      await page.evaluate(async edition=>{state.proType=edition;state.plan='pro';state.groupId=42;state.view='create';await renderGroups();},edition);
      await page.click('#exhibit-open');
      assert(await page.locator('#exhibit-editor').isVisible());
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1), `${edition} editor overflow at ${width}`);
      // Exact reconstruction across continuation pages proves no note text is lost.
      for(const field of ['title','address','date'])await page.uncheck('#exhibit-field-'+field);
      for(const orientation of ['portrait','landscape']){
       await page.selectOption('#exhibit-orientation',orientation);
       await page.selectOption('#exhibit-count','1');
       await page.click('#exhibit-preview');
       await page.waitForFunction(()=>!document.querySelector('#exhibit-print').disabled);
       const result = await page.locator('#exhibit-frame').evaluate(frame=>{
        const doc=frame.contentDocument;
        return {pages:doc.querySelectorAll('.page').length,text:doc.body.textContent,note:[...doc.querySelectorAll('.photo > div')].map(el=>el.textContent).join(''),overflow:[...doc.querySelectorAll('.content')].some(el=>el.scrollHeight>el.clientHeight+1),images:[...doc.images].every(img=>img.naturalWidth>0),max:[...doc.querySelectorAll('.page')].every(p=>p.querySelectorAll('.photo').length<=1)};
       });
       assert(result.pages>1);if(result.note!==fixtureNote+'Second note'){fs.writeFileSync(path.join(output,'note-mismatch.json'),JSON.stringify({engine:engine.name(),width,edition,orientation,actual:result.note,expected:fixtureNote+'Second note',html:await page.locator('#exhibit-frame').evaluate(f=>f.contentDocument.documentElement.outerHTML)}));throw Error('Exact note mismatch, see note-mismatch.json');}assert(result.images);assert(!result.overflow);assert(result.max);assert(!result.text.includes('12, 34'));assert(!result.text.includes('PRIVATE COMMENT'));
       if(engine===chromium&&width===1440&&edition==='general'){
        const html=await page.locator('#exhibit-frame').evaluate(f=>f.contentDocument.documentElement.outerHTML);
        const printPage=await browser.newPage();await printPage.goto(`http://127.0.0.1:${server.address().port}/proposal-exhibit.js`);await printPage.setContent(html);await printPage.evaluate(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))));
        await printPage.pdf({path:path.join(output,orientation+'.pdf'),preferCSSPageSize:true,printBackground:true});
        await printPage.screenshot({path:path.join(output,orientation+'.png'),fullPage:true});await printPage.close();
       }
      }
      await page.check('#exhibit-field-gps');await page.click('#exhibit-add');await page.fill('[data-key="text"]','Scope for proposal review');await page.fill('[data-key="page"]','2');await page.click('#exhibit-preview');await page.waitForFunction(()=>!document.querySelector('#exhibit-print').disabled);
      assert(await page.locator('#exhibit-frame').evaluate(f=>f.contentDocument.body.textContent.includes('12, 34')&&f.contentDocument.querySelectorAll('.page')[1].textContent.includes('Scope for proposal review')));
      await page.click('#exhibit-close');await page.click('#exhibit-open');assert.equal(await page.locator('[data-key="text"]').inputValue(),'Scope for proposal review');await page.click('#exhibit-close');
     }
     // Reject geometry that could print outside the page; leave print unavailable.
     await page.click('#exhibit-open');await page.fill('[data-key="width"]','20');await page.click('#exhibit-preview');assert(await page.locator('#exhibit-print').isDisabled());assert((await page.locator('#exhibit-status').textContent()).includes('fit inside'));
     assert.deepEqual(errors,[]);
     console.log(`${engine.name()} ${width}: integrated Create, eight editions, both orientations, exact long notes, privacy, text boxes, local draft and bounds PASS`);
     await page.close();
    }
   } finally { await browser.close(); }
  }
 } finally { server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});

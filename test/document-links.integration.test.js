const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('document snapshots: exact exports, owner isolation, expiry, revoke and browser link sharing',{skip:process.env.PN_DOCUMENT_LINKS!=='1',timeout:120000},async()=>{
  process.env.DATABASE_URL='postgresql://127.0.0.1:55489/pn_pro_retest';
  process.env.SESSION_SECRET='document-links-local-test-secret-12345678';
  process.env.UPLOAD_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'pn-link-test-'));
  const {pool,init}=require('../db');
  assert.equal((await pool.query('SHOW data_directory')).rows[0].data_directory,'/tmp/pn-pro-retest/db');
  await init();
  const {app}=require('../server'),jwt=require('jsonwebtoken');
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port,users=[];
  try {
    for(let i=0;i<2;i++)users.push((await pool.query("INSERT INTO users(email,password_hash,plan) VALUES($1,'unused','pro') RETURNING id",['links-'+Date.now()+'-'+i+'@example.invalid'])).rows[0].id);
    const tokens=users.map(id=>jwt.sign({id},process.env.SESSION_SECRET));
    const headers=owner=>({Cookie:'pn_token='+tokens[owner]});
    const create=(bytes,format='docx',owner=0,guard=true)=>fetch(base+'/api/document-links?format='+format+'&name=Test.'+(format==='bundle'?'zip':format),{method:'POST',headers:{...headers(owner),'Content-Type':'application/octet-stream',...(guard?{'X-Photo-Notes-Share':'1'}:{})},body:bytes});
    assert.equal((await fetch(base+'/api/document-links')).status,401);
    assert.equal((await create(Buffer.from('%PDF-fixture'),'pdf',0,false)).status,403);
    assert.equal((await create(Buffer.from('bad'),'docx')).status,400);
    const sharp=require('sharp');
    fs.writeFileSync(path.join(process.env.UPLOAD_DIR,'link-fixture.jpg'),await sharp({create:{width:100,height:100,channels:3,background:'#ffffff'}}).jpeg().toBuffer());
    const capture=(await pool.query("INSERT INTO captures(user_id,photo_path,note) VALUES($1,'/uploads/link-fixture.jpg','Shared snapshot fixture') RETURNING id",[users[0]])).rows[0].id;
    let last,word;
    for(const format of ['docx','bundle','pdf']){
      const exported=await fetch(base+'/api/export/'+format+'?ids='+capture,{headers:headers(0)});
      assert.equal(exported.status,200);const bytes=Buffer.from(await exported.arrayBuffer());if(format==='docx')word=bytes;
      const response=await create(bytes,format);assert.equal(response.status,201,await response.clone().text());last=await response.json();
      const download=await fetch(base+last.path);
      assert.equal(download.status,200);assert.equal(download.headers.get('cache-control'),'no-store');
      assert.match(download.headers.get('content-disposition'),/^attachment/);
      assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
    }
    // Another owner cannot list or revoke this owner's snapshot.
    assert.deepEqual(await(await fetch(base+'/api/document-links',{headers:headers(1)})).json(),[]);
    assert.equal((await fetch(base+'/api/document-links/'+last.id,{method:'DELETE',headers:{...headers(1),'X-Photo-Notes-Share':'1'}})).status,404);
    await pool.query('UPDATE users SET active=false WHERE id=$1',[users[0]]);
    assert.equal((await fetch(base+last.path)).status,404);
    await pool.query('UPDATE users SET active=true WHERE id=$1',[users[0]]);
    await pool.query("UPDATE document_share_links SET expires_at=now()-interval '1 second' WHERE id=$1",[last.id]);
    assert.equal((await fetch(base+last.path)).status,404);
    const revoked=await(await create(word)).json();
    assert.equal((await fetch(base+'/api/document-links/'+revoked.id,{method:'DELETE',headers:{...headers(0),'X-Photo-Notes-Share':'1'}})).status,200);
    assert.equal((await fetch(base+revoked.path)).status,404);
    // The browser uploads the prepared file and shares a URL on a fresh click,
    // including after native file sharing rejects it on Windows.
    const {chromium,webkit}=require('playwright');
    for(const [engine,width,language] of [[chromium,1440,'en'],[webkit,390,'es']]){
      const browser=await engine.launch({headless:true});
      try {
        const context=await browser.newContext({viewport:{width,height:844},...(engine===chromium?{userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36'}:{})});
        await context.addCookies([{name:'pn_token',value:tokens[0],url:base}]);
        const page=await context.newPage();
        await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
        await page.addInitScript(()=>{
          window.sharedLink=null;
          Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
          Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{
            if(data.files)throw Object.assign(Error('Files blocked'),{name:'NotAllowedError'});
            window.sharedLink=data.url;
          }});
          Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copiedLink=value;}}});
        });
        await page.goto(base,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>typeof openPreparedExportShare==='function'&&!!window.PhotoNotesDocumentLinks);
        await page.evaluate(async({capture})=>{
          const r=await fetch('/api/export/docx?ids='+capture);const file=new File([await r.blob()],'Test.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
          openPreparedExportShare(file,'docx',null);
        },{capture});
        if(engine===chromium)assert.equal(await page.locator('[data-share-open]').isVisible(),false);
        else {
          await page.locator('[data-share-open]').click();
          await page.getByText('This browser could not share the document. Create a share link below, or use Download.',{exact:true}).waitFor();
        }
        await page.getByRole('button',{name:'Create share link',exact:true}).click();
        await page.getByRole('button',{name:'Copy link',exact:true}).click();
        const copied=await page.evaluate(()=>window.copiedLink);assert.ok(copied.startsWith(base+'/shared-document/'));
        await page.getByRole('button',{name:'Share link',exact:true}).click();
        assert.equal(await page.evaluate(()=>window.sharedLink),copied);
        assert.equal((await fetch(copied)).status,200);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        if(language==='es'){
          await page.evaluate(()=>window.photoNotesI18n.setLanguage('es'));
          await page.getByRole('button',{name:'Compartir enlace',exact:true}).waitFor();
        }
        if(process.env.PN_LINK_SCREENSHOTS)await page.screenshot({path:path.join(process.env.PN_LINK_SCREENSHOTS,engine.name()+'.png'),fullPage:true});
        if(language==='es')await page.evaluate(()=>window.photoNotesI18n.setLanguage('en'));
        await page.locator('[data-share-close]').click();
        await page.evaluate(()=>renderSend());
        await page.locator('#sharedDocumentLinks summary').click();
        await page.getByRole('button',{name:'Revoke link',exact:true}).first().click();
        await page.getByText('Link revoked. Recipients can no longer download the file through this link.',{exact:true}).waitFor();
        assert.equal((await fetch(copied)).status,404);
      } finally {await browser.close();}
    }
    // Enforce capacity with a serialized check, not a client-only limit.
    await pool.query('DELETE FROM document_share_links WHERE user_id=$1',[users[0]]);
    await pool.query("INSERT INTO document_share_links(user_id,token,filename,mime_type,content,expires_at) SELECT $1,'quota-'||n,'fixture.docx','application/octet-stream',$2,now()+interval '1 day' FROM generate_series(1,20)n",[users[0],word]);
    assert.equal((await create(word)).status,409);
  } catch(error) { console.error(error); throw error; } finally {
    await pool.query('DELETE FROM captures WHERE user_id=ANY($1)',[users]);
    await pool.query('DELETE FROM users WHERE id=ANY($1)',[users]);
    await new Promise(r=>server.close(r));await pool.end();fs.rmSync(process.env.UPLOAD_DIR,{recursive:true,force:true});
  }
});

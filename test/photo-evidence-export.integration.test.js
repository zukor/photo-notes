const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('real exports retain paired and instrument details with their photos',{skip:process.env.PN_EVIDENCE_EXPORT_TEST!=='1',timeout:120000},async()=>{
 process.env.DATABASE_URL='postgresql://127.0.0.1:55491/pn_evidence_retest';process.env.PGSSL='disable';process.env.SESSION_SECRET='local-evidence-test';process.env.UPLOAD_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'pn-evidence-'));delete process.env.ANTHROPIC_API_KEY;
 const {pool,init}=require('../db');assert.equal((await pool.query('SHOW data_directory')).rows[0].data_directory,'/tmp/pn-evidence-retest/db');await init();
 const {app}=require('../server'),sharp=require('sharp'),jwt=require('jsonwebtoken'),Zip=require('pizzip');const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let owner;
 try{
 owner=(await pool.query("INSERT INTO users(email,password_hash,role,plan,pro_type,edition_access) VALUES($1,'none','admin','pro','paving',ARRAY['paving']) RETURNING id",['evidence-'+Date.now()+'@example.invalid'])).rows[0];const cookie='pn_token='+jwt.sign({id:owner.id},process.env.SESSION_SECRET);
 const req=(url,body)=>fetch('http://127.0.0.1:'+server.address().port+url,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const ids=[];for(const [i,color] of ['blue','green'].entries()){fs.writeFileSync(path.join(process.env.UPLOAD_DIR,`photo${i}.jpg`),await sharp({create:{width:900,height:700,channels:3,background:color}}).jpeg().toBuffer());ids.push((await pool.query("INSERT INTO captures(user_id,photo_path,photo_title,note,address,area_tags) VALUES($1,$2,$3,$4,$5,ARRAY['Paving']) RETURNING id",[owner.id,`/uploads/photo${i}.jpg`,i?'After Photo':'Before Photo',i?'AFTER UNIQUE NOTE':'BEFORE UNIQUE NOTE','Chak 274 Hakra, پنجاب'])).rows[0].id);}
 assert.equal((await req('/api/pairs',{before_id:ids[0],after_id:ids[1],comparison_opacity:0.5})).status,200);
 for(const format of ['pdf','docx']){const r=await req('/api/export/'+format+'?ids='+ids.join(','));assert.equal(r.status,200);const b=Buffer.from(await r.arrayBuffer());assert(b.length>1000);if(process.env.PN_EVIDENCE_OUTPUT)fs.writeFileSync(path.join(process.env.PN_EVIDENCE_OUTPUT,'paired.'+format),b);if(format==='docx'){const xml=new Zip(b).file('word/document.xml').asText();const cells=xml.match(/<w:tc>.*?<\/w:tc>/gs);assert(cells[0].includes('BEFORE UNIQUE NOTE'));assert(!cells[0].includes('AFTER UNIQUE NOTE'));assert(cells[1].includes('AFTER UNIQUE NOTE'));assert(xml.includes('پنجاب'));}}
 const reading=(await pool.query("INSERT INTO camera_readings(user_id,reading_type,photo_path,title,fields,status) VALUES($1,'gauge','/uploads/photo0.jpg','pressure gauge',$2,'saved') RETURNING id",[owner.id,JSON.stringify({notes:'Dual scale instrument. '.repeat(50),reading:'8',unit:'kg/cm²',instrument_type:'pressure gauge',equipment_name:'Pump A'})])).rows[0];
 const capture=await(await req(`/api/camera-readings/${reading.id}/library`,{})).json();assert(capture.capture_id);
 for(const format of ['pdf','docx']){const r=await req('/api/export/'+format+'?ids='+capture.capture_id);assert.equal(r.status,200);const b=Buffer.from(await r.arrayBuffer());if(process.env.PN_EVIDENCE_OUTPUT)fs.writeFileSync(path.join(process.env.PN_EVIDENCE_OUTPUT,'instrument.'+format),b);if(format==='docx'){const xml=new Zip(b).file('word/document.xml').asText();const text=xml.replace(/<[^>]+>/g,'');assert(text.includes('Instrument Type: pressure gauge'));assert(text.includes('Equipment Name: Pump A'));assert(text.indexOf('Reading: 8')<text.indexOf('Notes: Dual'));assert(xml.includes('w:b'));}}

 const jobA=await(await req('/api/jobs',{name:'Job A'})).json(),jobB=await(await req('/api/jobs',{name:'Job B'})).json();
 await pool.query('UPDATE captures SET job_id=$1 WHERE id=$2',[jobA.id,ids[0]]);await pool.query('UPDATE captures SET job_id=$1 WHERE id=$2',[jobB.id,ids[1]]);
 const mixed=await(await req('/api/groups',{title:'Mixed Document',ids})).json(),onlyA=await(await req('/api/groups',{title:'A Document',ids:[ids[0]]})).json();
 // A template belongs to a document, including when documents span different jobs.
 const {Document,Paragraph,Packer}=require('docx');
 const template=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('CUSTOM TEMPLATE HEADING'),new Paragraph('CUSTOM CUSTOMER DETAILS'),new Paragraph('{{PHOTO_NOTES_CONTENT}}')]}]}));
 const upload=async(group)=>{const fd=new FormData();fd.append('group',String(group));fd.append('template',new Blob([template]),'customer.docx');return fetch('http://127.0.0.1:'+server.address().port+'/api/document-settings/template',{method:'POST',headers:{Cookie:cookie},body:fd});};
 assert.equal((await upload(onlyA.id)).status,200);
 assert.equal((await(await req('/api/document-settings?group='+onlyA.id)).json()).template_ready,true);
 assert.equal((await(await req('/api/document-settings?group='+mixed.id)).json()).template_ready,false);
 const outsider=(await pool.query("INSERT INTO users(email,password_hash) VALUES($1,'none') RETURNING id",['outsider-'+Date.now()+'@example.invalid'])).rows[0];
 const foreign=(await pool.query("INSERT INTO groups(user_id,title) VALUES($1,'Private') RETURNING id",[outsider.id])).rows[0];
 assert.equal((await upload(foreign.id)).status,400);
 assert.equal((await req('/api/document-settings/remove-asset',{kind:'template',group:foreign.id})).status,404);
 for(const format of ['pdf','docx']){
  const r=await req('/api/export/'+format+'?group='+onlyA.id);assert.equal(r.status,200);
  const bytes=Buffer.from(await r.arrayBuffer()),file=path.join(process.env.PN_EVIDENCE_OUTPUT||os.tmpdir(),'template-document.'+format);fs.writeFileSync(file,bytes);
  const text=format==='docx'?new Zip(bytes).file('word/document.xml').asText():require('node:child_process').execFileSync('pdftotext',[file,'-'],{encoding:'utf8'});
  assert(text.includes('CUSTOM TEMPLATE HEADING'));assert(text.includes('CUSTOM CUSTOMER DETAILS'));assert(text.includes('BEFORE UNIQUE NOTE'));assert(!text.includes('A Document'));
 }
 assert.equal((await req('/api/document-settings/remove-asset',{kind:'template',group:onlyA.id})).status,200);
 assert.equal((await(await req('/api/document-settings?group='+onlyA.id)).json()).template_ready,false);
 const record=async(group,job,description)=>(await pool.query("INSERT INTO extra_work_records(user_id,group_id,job_id,description_text,reason_category) VALUES($1,$2,$3,$4,'unforeseen_site_condition') RETURNING id",[owner.id,group,job,description])).rows[0].id;
 const explicit=await record(mixed.id,jobA.id,'CORRECT EXTRA WORK');await record(mixed.id,null,'AMBIGUOUS MUST NOT APPEAR');await record(onlyA.id,jobB.id,'OTHER JOB MUST NOT APPEAR');await record(onlyA.id,null,'LEGACY CORRECT');
 fs.writeFileSync(path.join(process.env.UPLOAD_DIR,'extra.jpg'),await sharp({create:{width:700,height:500,channels:3,background:'red'}}).jpeg().toBuffer());
 await pool.query("INSERT INTO ewr_photos(ewr_id,user_id,photo_path,caption) VALUES($1,$2,'/uploads/extra.jpg','CORRECT EXTRA PHOTO')",[explicit,owner.id]);
 const created=await(await req('/api/ewr',{group_id:onlyA.id,reason_category:'unforeseen_site_condition',description_text:'NEW CORRECT'})).json();assert.equal(created.record.job_id,jobA.id);
 assert.equal((await req('/api/ewr/'+explicit,{job_id:'nonsense'})).status,400);
 for(const format of ['pdf','docx']){const r=await req(`/api/paving/jobs/${jobA.id}/report?doc=${format}`);assert.equal(r.status,200);const b=Buffer.from(await r.arrayBuffer());const file=path.join(process.env.PN_EVIDENCE_OUTPUT||os.tmpdir(),'job-evidence.'+format);fs.writeFileSync(file,b);
  let text;if(format==='docx'){text=new Zip(b).file('word/document.xml').asText();assert(Object.keys(new Zip(b).files).filter(k=>k.startsWith('word/media/')&&!k.endsWith('/')).length>=2);}else{const cp=require('node:child_process');text=cp.execFileSync('pdftotext',[file,'-'],{encoding:'utf8'});const images=cp.execFileSync('pdfimages',['-list',file],{encoding:'utf8'});assert.match(images,/\n\s*1\s+0\s+image/,'photo evidence begins on page one');assert(images.split('\n').filter(l=>/image/.test(l)).length>=2);}
  assert(text.includes('CORRECT EXTRA WORK'));assert(text.includes('CORRECT EXTRA PHOTO'));assert(text.includes('LEGACY CORRECT'));assert(!text.includes('AMBIGUOUS MUST NOT APPEAR'));assert(!text.includes('OTHER JOB MUST NOT APPEAR'));
 }
 await pool.query('UPDATE captures SET job_id=$1 WHERE id=ANY($2)',[jobA.id,ids]);
 for(const format of ['pdf','docx']){const r=await req(`/api/paving/jobs/${jobA.id}/report?doc=${format}`);assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer());const file=path.join(process.env.PN_EVIDENCE_OUTPUT||os.tmpdir(),'job-pair.'+format);fs.writeFileSync(file,bytes);
  if(format==='docx'){const xml=new Zip(bytes).file('word/document.xml').asText();assert(xml.includes('BEFORE UNIQUE NOTE'));assert(xml.includes('AFTER UNIQUE NOTE'));assert(!xml.includes('Before and after comparison'));}
  else{const text=require('node:child_process').execFileSync('pdftotext',[file,'-'],{encoding:'utf8'});assert(text.includes('BEFORE UNIQUE NOTE'));assert(text.includes('AFTER UNIQUE NOTE'));}
 }
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await pool.end();}
});

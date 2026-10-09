const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
test('scanner routes retain photos, extract fields, save reviews and report service outages',{skip:process.env.PN_SCANNER_RETEST!=='1',timeout:60000},async()=>{
 process.env.DATABASE_URL=process.env.PN_LEGACY_TEST_DATABASE_URL||'postgresql://127.0.0.1:55489/pn_pro_retest';
 process.env.SESSION_SECRET='scanner-retest-local-session-secret';
 process.env.UPLOAD_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'pn-scanner-retest-'));
 delete process.env.ANTHROPIC_API_KEY;
 const {pool,init}=require('../db');assert.equal((await pool.query('SHOW data_directory')).rows[0].data_directory,process.env.PN_AUTOMATION_DATA_DIR||'/tmp/pn-pro-retest/db');await init();
 const {app}=require('../server'),jwt=require('jsonwebtoken'),sharp=require('sharp');
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port,nativeFetch=global.fetch;let user,providerCalls=0,providerStatus=200,extracted={};
 // Intercept only the provider. This test must never incur paid AI calls.
 global.fetch=async(url,opts)=>{
  if(String(url)==='https://api.anthropic.com/v1/messages'){
   providerCalls++;return providerStatus===200?new Response(JSON.stringify({content:[{type:'text',text:JSON.stringify(extracted)}]}),{status:200}):new Response('{}',{status:providerStatus});
  }
  return nativeFetch(url,opts);
 };
 try {
  user=(await pool.query("INSERT INTO users(email,password_hash,role,plan,pro_type) VALUES($1,'not-a-password','admin','pro','paving') RETURNING id",['scanner-'+Date.now()+'@example.invalid'])).rows[0];
  process.env.SUPER_ADMIN_USER_IDS=String(user.id);
  const cookie='pn_token='+jwt.sign({id:user.id},process.env.SESSION_SECRET);
  const image=await sharp({create:{width:100,height:100,channels:3,background:'white'}}).jpeg().toBuffer();
  const scan=async(route,type)=>{
   const form=new FormData();form.append('photo',new Blob([image],{type:'image/jpeg'}),'fixture.jpg');if(type)form.append('reading_type',type);
   const r=await fetch(base+route,{method:'POST',headers:{Cookie:cookie},body:form});assert.equal(r.status,200);return r.json();
  };
  for(const [route,type,key] of [['/api/asphalt-tickets/scan',null,'ticket'],['/api/camera-readings/scan','plan_sketch','reading']]){
   const d=await scan(route,type);assert.equal(d.ai_read,false);assert.equal(d.ai_error,'not_configured');assert.ok(d[key].id);
   assert.ok(fs.existsSync(path.join(process.env.UPLOAD_DIR,path.basename(d[key].photo_path))));
  }
  assert.equal(providerCalls,0);process.env.ANTHROPIC_API_KEY='test-only-never-sent';
  extracted={ticket_number:'T-0042',net_tons:18.64,truck_number:'007',confidence:'high'};
  const ticket=await scan('/api/asphalt-tickets/scan');assert.equal(ticket.ai_read,true);assert.equal(ticket.ai_error,null);
  assert.equal(ticket.ticket.ticket_number,'T-0042');assert.equal(Number(ticket.ticket.net_tons),18.64);
  const saved=await fetch(base+'/api/asphalt-tickets/'+ticket.ticket.id,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({...ticket.ticket,ticket_number:'T-0042-CHECKED'})});
  assert.equal(saved.status,200);
  assert.equal((await pool.query('SELECT ticket_number FROM asphalt_tickets WHERE id=$1',[ticket.ticket.id])).rows[0].ticket_number,'T-0042-CHECKED');
  for(const [type,data,field] of [
   ['plan_sketch',{project_name:'Test site',scale:'1:100',sheet_number:'A-01'},'sheet_number'],
   ['business_card',{name:'Synthetic Contact',email:'fixture@example.invalid'},'email'],
   ['gauge',{instrument_type:'Pressure',reading:'75',unit:'psi'},'reading'],
   ['equipment_plate',{manufacturer:'Fixture',model:'A-42'},'model'],
   ['material_label',{product_name:'Test mix',lot_number:'00077'},'lot_number'],
  ]){
   if(type==='business_card')await pool.query("UPDATE users SET pro_type='contractor' WHERE id=$1",[user.id]);
   extracted={...data,confidence:'high'};const d=await scan('/api/camera-readings/scan',type);
   assert.equal(d.ai_read,true);assert.equal(d.reading.fields[field],data[field]);
   if(type==='business_card')await pool.query("UPDATE users SET pro_type='paving' WHERE id=$1",[user.id]);
  }
  extracted={length_in:12,width_in:6,depth_in:null,shape:'rectangle',confidence:'high',warning:null};
  const measured=await scan('/api/measure');assert.equal(measured.ok,true);assert.equal(measured.length_in,12);
  const capture=(await pool.query('INSERT INTO captures(user_id,photo_path) VALUES($1,$2) RETURNING id',[user.id,ticket.ticket.photo_path])).rows[0];
  extracted={defect_type:'pothole',severity:'high',confidence:'high',rationale:'Synthetic fixture'};
  const classified=await(await fetch(base+'/api/captures/'+capture.id+'/classify',{method:'POST',headers:{Cookie:cookie}})).json();
  assert.equal(classified.ok,true);assert.equal(classified.capture.defect_type,'pothole');
  providerStatus=401;
  const blocked=await(await fetch(base+'/api/captures/'+capture.id+'/classify',{method:'POST',headers:{Cookie:cookie}})).json();
  assert.equal(blocked.ok,false);assert.equal(blocked.ai_error,'authentication');
  assert.equal((await pool.query('SELECT defect_type FROM captures WHERE id=$1',[capture.id])).rows[0].defect_type,'pothole');
  for(const status of [401,402,429,529]){
   providerStatus=status;const d=await scan('/api/asphalt-tickets/scan');
   assert.equal(d.ai_read,false);assert.ok(d.ai_message);assert.notEqual(d.ai_error,'unreadable');
  }
  const health=await(await fetch(base+'/api/admin/health',{headers:{Cookie:cookie}})).json();
  assert.equal(health.services.find(s=>s.id==='ai').last_result.status,'unavailable');
  delete process.env.ANTHROPIC_API_KEY;
  const fixture=path.join(process.env.UPLOAD_DIR,'browser-fixture.jpg');fs.writeFileSync(fixture,image);
  const {chromium}=require('playwright'),browser=await chromium.launch({headless:true});
  try {
   const context=await browser.newContext({viewport:{width:390,height:844}});
   await context.addCookies([{name:'pn_token',value:cookie.slice('pn_token='.length),url:base}]);
   const page=await context.newPage();
   await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
   await page.goto(base,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>typeof renderTicketScanner==='function'&&state.me);
   await page.locator('#body').waitFor();await page.evaluate(()=>{localStorage.setItem('pn_first_use_v1:'+encodeURIComponent(state.me.email),'done');document.getElementById('firstUseSetup')?.close();});
   await page.evaluate(()=>{state.view='ticket-scanner';renderTicketScanner();});
   await page.locator('#ticketLib').setInputFiles(fixture);
   await page.locator('#ticketRead').click();
   await page.getByText('Automatic scanning is not set up yet. Your photo is available for manual entry.',{exact:true}).waitFor();
   assert.equal(await page.locator('#ticketRead').isEnabled(),true);
   assert.equal(await page.locator('#ticketSave').isVisible(),true);
   await page.evaluate(()=>{state.view='camera-reader';cameraReaderType='plan_sketch';renderCameraReader();window.photoNotesI18n.setLanguage('es');});
   await page.locator('#readerLib').setInputFiles(fixture);
   await page.locator('#readerRead').click();
   await page.getByText('La lectura automática aún no está configurada. Su foto está disponible para ingresar los datos manualmente.',{exact:true}).waitFor();
   assert.equal(await page.locator('#readerRead').isEnabled(),true);
   assert.equal(await page.locator('#readerSave').isVisible(),true);
   if(process.env.PN_SCANNER_SCREENSHOT)await page.screenshot({path:process.env.PN_SCANNER_SCREENSHOT,fullPage:true});
  } finally {await browser.close();}


  // Reports use reviewed saved fields, retain source photos, and preserve legacy access.
  const cases=[['material_label',{product_name:'MANUAL PRODUCT',manufacturer:'LABEL MAKER',product_code:'CODE-7',lot_number:'0009',quantity:'10',manufactured_date:'2026-01-01',expiration_date:'2027-01-01',instructions:'REVIEWED INSTRUCTIONS',warnings:'REVIEWED WARNINGS'}],['gauge',{instrument_type:'Thermometer',reading:'83',unit:'F',equipment_name:'WIKA',observed_at:'12:30',notes:'MANUAL READING NOTE'}],['business_card',{name:'MANUAL CONTACT',email:'manual@example.invalid',phone:'555-0100',company:'REVIEWED COMPANY',address:'SAVED ADDRESS'}],['plan_sketch',{project_name:'REVIEWED PROJECT',sheet_number:'A-22',scale:'1:100',visible_notes:'MANUAL PLAN NOTE'}],['equipment_plate',{manufacturer:'REVIEWED MAKER',model:'MODEL X',serial_number:'000123',specifications:'MANUAL SPECIFICATION'}]];
  await pool.query("UPDATE users SET pro_type='general',feature_access='{\"camera_readers\":false}' WHERE id=$1",[user.id]);
  const outsider=(await pool.query("INSERT INTO users(email,password_hash,plan,pro_type) VALUES($1,'none','pro','contractor') RETURNING id",['report-outsider-'+Date.now()+'@example.invalid'])).rows[0];
  for(const [type,fields] of cases){const row=(await pool.query("INSERT INTO camera_readings(user_id,reading_type,title,fields,photo_path,status) VALUES($1,$2,'REVIEWED REPORT',$3,$4,'saved') RETURNING id",[user.id,type,JSON.stringify(fields),ticket.ticket.photo_path])).rows[0];
   for(const format of ['pdf','docx']){const r=await fetch(base+`/api/camera-readings/${row.id}/report?format=${format}`,{headers:{Cookie:cookie}});assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer()),file=path.join(os.tmpdir(),`pn-scanner-${type}.${format}`);fs.writeFileSync(file,bytes);let text;if(format==='docx'){const Zip=require('pizzip'),zip=new Zip(bytes);text=zip.file('word/document.xml').asText();assert(Object.keys(zip.files).some(k=>k.startsWith('word/media/')&&!k.endsWith('/')));}else{const cp=require('node:child_process');text=cp.execFileSync('pdftotext',[file,'-'],{encoding:'utf8'});assert.match(cp.execFileSync('pdfimages',['-list',file],{encoding:'utf8'}),/image/);}for(const value of Object.values(fields))assert(text.includes(value),value);}
   if(type==='business_card'){const r=await fetch(base+`/api/camera-readings/${row.id}/report?format=vcf`,{headers:{Cookie:cookie}});assert.equal(r.status,200);assert.match(await r.text(),/FN:MANUAL CONTACT/);}
   else assert.equal((await fetch(base+`/api/camera-readings/${row.id}/report?format=vcf`,{headers:{Cookie:cookie}})).status,400);
   const outsiderCookie='pn_token='+require('jsonwebtoken').sign({id:outsider.id},process.env.SESSION_SECRET);assert.equal((await fetch(base+`/api/camera-readings/${row.id}/report`,{headers:{Cookie:outsiderCookie}})).status,404);
  }
  await pool.query('DELETE FROM users WHERE id=$1',[outsider.id]);
  for(const format of ['pdf','docx']){const r=await fetch(base+`/api/asphalt-tickets/${ticket.ticket.id}/report?format=${format}`,{headers:{Cookie:cookie}});assert.equal(r.status,200);assert((await r.arrayBuffer()).byteLength>1000);}

  // Linked evidence follows the owned source photo into Library and document exports.
  const request=async(url,body,method)=>fetch(base+url,{method:method||(body?'POST':'GET'),headers:{Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  await pool.query("UPDATE users SET pro_type='concrete',feature_access='{}' WHERE id=$1",[user.id]);
  const areaResponse=await request('/api/concrete/footprints',{capture_id:capture.id,name:'SOURCE AREA',points:[],field_length_ft:30,field_width_ft:40,field_method:'tape',notes:'AREA SOURCE NOTE'});assert.equal(areaResponse.status,200);
  const fields={instrument_type:'Thermometer',reading:'83',unit:'F',equipment_name:'GAUGE SOURCE',notes:'LONG SOURCE NOTE'};
  const gauge=(await pool.query("INSERT INTO camera_readings(user_id,reading_type,title,fields,photo_path,status) VALUES($1,'gauge','Thermometer',$2,$3,'saved') RETURNING id",[user.id,JSON.stringify(fields),ticket.ticket.photo_path])).rows[0];
  const linked=await(await request('/api/camera-readings/'+gauge.id+'/library',{})).json();assert(linked.capture_id);
  let listed=await(await request('/api/captures')).json();assert.equal(listed.find(c=>c.id===capture.id).footprints.length,1);assert.equal(listed.find(c=>c.id===linked.capture_id).gauge_record.fields.reading,'83');
  const edited=await request('/api/camera-readings/'+gauge.id,{title:'Thermometer',fields:{...fields,reading:'84'}});assert.equal(edited.status,200);
  assert.match((await pool.query('SELECT note FROM captures WHERE id=$1',[linked.capture_id])).rows[0].note,/Reading: 84/);
  const group=await(await request('/api/groups',{title:'LINKED SOURCE REPORT',ids:[capture.id,linked.capture_id]})).json();
  const document=await(await request('/api/groups/'+group.id)).json();assert.equal(document.items.find(c=>c.id===capture.id).footprints[0].name,'SOURCE AREA');
  for(const format of ['pdf','docx']){const r=await request('/api/export/'+format+'?group='+group.id);assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer());let text;if(format==='docx')text=new(require('pizzip'))(bytes).file('word/document.xml').asText();else{const file=path.join(os.tmpdir(),'pn-linked-source.pdf');fs.writeFileSync(file,bytes);text=require('node:child_process').execFileSync('pdftotext',[file,'-'],{encoding:'utf8'});}for(const value of ['SOURCE AREA','1,200','AREA SOURCE NOTE','GAUGE SOURCE','84','LONG SOURCE NOTE'])assert(text.includes(value),format+': '+value);}
  // User-authored notes survive scanner corrections.
  await pool.query("UPDATE captures SET note='USER AUTHORED NOTE' WHERE id=$1",[linked.capture_id]);await request('/api/camera-readings/'+gauge.id,{title:'Thermometer',fields:{...fields,reading:'85'}});assert.equal((await pool.query('SELECT note FROM captures WHERE id=$1',[linked.capture_id])).rows[0].note,'USER AUTHORED NOTE');
  await pool.query("UPDATE users SET pro_type='general' WHERE id=$1",[user.id]);listed=await(await request('/api/captures')).json();assert(!listed.find(c=>c.id===capture.id).footprints);assert(!listed.find(c=>c.id===linked.capture_id).gauge_record);
  const job=await(await request('/api/jobs',{name:'MISTAKEN JOB'})).json();await pool.query('UPDATE captures SET job_id=$1 WHERE id=$2',[job.id,capture.id]);await pool.query('UPDATE asphalt_tickets SET job_id=$1 WHERE id=$2',[job.id,ticket.ticket.id]);
  const foreign=(await pool.query("INSERT INTO users(email,password_hash,plan,pro_type) VALUES($1,'none','pro','general') RETURNING id",['job-foreign-'+Date.now()+'@example.invalid'])).rows[0],foreignCookie='pn_token='+require('jsonwebtoken').sign({id:foreign.id},process.env.SESSION_SECRET);
  assert.equal((await fetch(base+'/api/jobs/'+job.id,{method:'DELETE',headers:{Cookie:foreignCookie}})).status,404);
  assert.equal((await request('/api/jobs/'+job.id,null,'DELETE')).status,200);assert.equal((await pool.query('SELECT job_id FROM captures WHERE id=$1',[capture.id])).rows[0].job_id,null);assert.equal((await pool.query('SELECT job_id FROM asphalt_tickets WHERE id=$1',[ticket.ticket.id])).rows[0].job_id,null);assert.equal((await request('/api/jobs/'+job.id,null,'DELETE')).status,404);await pool.query('DELETE FROM users WHERE id=$1',[foreign.id]);
  const legacy=await(await fetch(base+'/api/camera-readings?type=business_card',{headers:{Cookie:cookie}})).json();assert(legacy.length>0);
 } catch(error){console.error(error.stack);throw error;} finally {
  global.fetch=nativeFetch;
  try{if(user){await pool.query('DELETE FROM groups WHERE user_id=$1',[user.id]);await pool.query('DELETE FROM captures WHERE user_id=$1',[user.id]);await pool.query('DELETE FROM events WHERE user_id=$1',[user.id]);await pool.query('DELETE FROM users WHERE id=$1',[user.id]);}}catch(error){console.error('Cleanup: '+error.stack);throw error;}finally{await new Promise(r=>server.close(r));await pool.end();fs.rmSync(process.env.UPLOAD_DIR,{recursive:true,force:true});}
 }
});

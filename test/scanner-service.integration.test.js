const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
test('scanner routes retain photos, extract fields, save reviews and report service outages',{skip:process.env.PN_SCANNER_RETEST!=='1',timeout:60000},async()=>{
 process.env.DATABASE_URL='postgresql://127.0.0.1:55489/pn_pro_retest';
 process.env.SESSION_SECRET='scanner-retest-local-session-secret';
 process.env.UPLOAD_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'pn-scanner-retest-'));
 delete process.env.ANTHROPIC_API_KEY;
 const {pool,init}=require('../db');assert.equal((await pool.query('SHOW data_directory')).rows[0].data_directory,'/tmp/pn-pro-retest/db');await init();
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
   extracted={...data,confidence:'high'};const d=await scan('/api/camera-readings/scan',type);
   assert.equal(d.ai_read,true);assert.equal(d.reading.fields[field],data[field]);
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
   await page.locator('#body').waitFor();
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

 } finally {
  global.fetch=nativeFetch;
  if(user){await pool.query('DELETE FROM captures WHERE user_id=$1',[user.id]);await pool.query('DELETE FROM events WHERE user_id=$1',[user.id]);await pool.query('DELETE FROM users WHERE id=$1',[user.id]);}
  await new Promise(r=>server.close(r));await pool.end();fs.rmSync(process.env.UPLOAD_DIR,{recursive:true,force:true});
 }
});

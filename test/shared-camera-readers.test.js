const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../server.js'),'utf8');
const editions=['general','paving','concrete','property','hoa','contractor','roofer'];
function gates(user){const context=vm.createContext({pool:{query:async()=>({rows:[user]})},normalizeProType:x=>x==='asphalt'?'paving':x});vm.runInContext(source.slice(source.indexOf('const MANAGED_FEATURES'),source.indexOf("app.get('/api/me'")),context);return context;}
test('reader eligibility and opt-out across all editions, specialist gates preserved',async()=>{
 for(const pro_type of [...editions,'issue','roads','unknown'])for(const plan of ['pro','free'])for(const enabled of [true,false]){
  const g=gates({plan,pro_type,feature_access:{camera_readers:enabled}});
  assert.equal(await g.featureAllowed(1,'camera_readers'),plan==='pro'&&editions.includes(pro_type)&&enabled);
  assert.equal(await g.featureAllowed(1,'ticket_scanner'),plan==='pro'&&pro_type==='paving');
  assert.equal(await g.featureAllowed(1,'measurements'),plan==='pro'&&['paving','concrete'].includes(pro_type));
 }
 for(const pro_type of editions)assert.equal(await gates({plan:'pro',pro_type}).featureAllowed(1,'camera_readers'),true);
});
test('actual reader routes preserve ownership, review, photo, publishing and manual fallback',async()=>{
 for(const pro_type of editions){
  let id=0;const records=new Map(),captures=[],routes={};const g=gates({plan:'pro',pro_type});
  const query=async(sql,p=[])=>{
   if(sql.includes('SELECT plan,pro_type,feature_access'))return {rows:[{plan:'pro',pro_type}]};
   if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql))return {rows:[]};
   if(sql.includes('INSERT INTO camera_readings')){const row={id:++id,user_id:p[0],reading_type:p[1],photo_path:p[2],title:p[3],fields:JSON.parse(p[4]),confidence:p[5],status:'draft'};records.set(id,row);return {rows:[row]};}
   if(sql.includes('INSERT INTO captures')){assert.equal(p[0],1);assert.equal(p[1],'Owner');assert.match(p[2],/^\/uploads\//);assert.match(p[6],/Reviewed/);captures.push(p);return {rows:[{id:captures.length}]};}
   if(sql.includes('SET capture_id')){records.get(p[1]).capture_id=p[0];return {rows:[]};}
   if(sql.includes('UPDATE camera_readings SET title')){assert(sql.includes('AND user_id=$4'));const row=records.get(p[2]);if(!row||row.user_id!==p[3])return {rows:[]};Object.assign(row,{title:p[0],fields:JSON.parse(p[1]),status:'saved'});return {rows:[row]};}
   if(sql.includes('WHERE id=$1 AND user_id=$2')){const row=records.get(p[0]);const found=row&&row.user_id===p[1]&&(!sql.includes("status='saved'")||row.status==='saved');if(sql.startsWith('DELETE')&&found)records.delete(p[0]);return {rows:found?[row]:[],rowCount:found?1:0};}
   if(sql.includes('SELECT * FROM camera_readings WHERE')){assert(sql.includes('user_id=$1'));return {rows:[...records.values()].filter(r=>r.user_id===p[0]&&r.status==='saved'&&(!p[1]||r.reading_type===p[1]))};}
   throw Error(sql);
  };
  Object.assign(g,{app:Object.fromEntries(['post','get','delete'].map(method=>[method,(url,...handlers)=>{assert.equal(handlers[0],g.requireAuth);routes[method+' '+url]=handlers.at(-1);} ])),requireAuth:()=>{},upload:{single:()=>()=>{}},pool:{query,connect:async()=>({query,release(){}})},ticketText:v=>v==null?null:String(v),visionJSON:async()=>({data:null}),visionFeedback:()=>({}),logEvent:()=>{},path:require('node:path'),fs,localPhoto:x=>x,imageDims:async()=>({w:100,h:100}),console,currentProduct:async()=>pro_type,require:x=>require('../public/scanner-availability'),fs:{...fs,unlinkSync:()=>{}}});
  vm.runInContext(source.slice(source.indexOf('const CAMERA_READER_TYPES'),source.indexOf('// ---- Road Issues Reporting')),g);
  async function call(method,url,user=1,params={},body={}){let status=200,data;const res={status(n){status=n;return this;},sendStatus(n){status=n;},json(v){data=v;}};await routes[method+' '+url]({user:{id:user,name:'Owner'},params,body,query:{},file:{path:'/tmp/source.png'}},res);return {status,data};}
  for(const reading_type of ['equipment_plate','gauge','plan_sketch','material_label','business_card']){
   const scan=await call('post','/api/camera-readings/scan',1,{}, {reading_type});if(!require('../public/scanner-availability').allowed(pro_type,reading_type)){assert.equal(scan.status,403);continue;}assert.equal(scan.data.ai_read,false);const record=scan.data.reading;assert.equal(record.confidence,'low');assert.equal(captures.length,id-1);
   assert.equal((await call('post','/api/camera-readings/:id/library',1,{id:record.id})).status,404);
   assert.equal((await call('post','/api/camera-readings/:id',2,{id:record.id},{title:'Alien'})).status,404);
   await call('post','/api/camera-readings/:id',1,{id:record.id},{title:'Reviewed',fields:{notes:'Reviewed visible information'}});
   for(const method of ['post','delete'])assert.equal((await call(method,method==='post'?'/api/camera-readings/:id/library':'/api/camera-readings/:id',2,{id:record.id})).status,404);
   const published=await call('post','/api/camera-readings/:id/library',1,{id:record.id});assert.equal(published.status,200);assert.equal((await call('post','/api/camera-readings/:id/library',1,{id:record.id})).data.capture_id,published.data.capture_id);
  }
  assert.equal(captures.length,['equipment_plate','gauge','plan_sketch','material_label','business_card'].filter(t=>require('../public/scanner-availability').allowed(pro_type,t)).length);assert.equal((await call('get','/api/camera-readings',2)).data.length,0);
 }
});

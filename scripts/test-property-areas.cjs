// Isolated local PostgreSQL schema and browser fixtures. Never uses .env or production.
const assert=require('node:assert/strict'),express=require('express'),{Client}=require('pg'),{chromium,webkit}=require('playwright'),{SCHEMA,register,validate}=require('../property-areas');
(async()=>{
 const db=new Client(process.env.PN_ISOLATED_DATABASE_URL?{connectionString:process.env.PN_ISOLATED_DATABASE_URL}:{host:'/tmp',database:'postgres',user:require('node:os').userInfo().username});await db.connect();const schema='area_test_'+process.pid;let server;
 try{
 await db.query(`CREATE SCHEMA ${schema}`);await db.query(`SET search_path TO ${schema}`);
 await db.query(`CREATE TABLE hoa_management_companies(id integer primary key);CREATE TABLE hoa_communities(id integer primary key,company_id integer,name text,active boolean default true);CREATE TABLE captures(id integer primary key,user_id integer);CREATE TABLE hoa_assets(id integer primary key,company_id integer,community_id integer);CREATE TABLE hoa_maintenance_items(id integer primary key,company_id integer,community_id integer);CREATE TABLE hoa_inspection_stops(id integer primary key);CREATE TABLE hoa_visit_stops(id integer primary key);INSERT INTO hoa_communities VALUES(1,1,'Property A',true),(2,1,'Property B',true),(3,2,'Other Company',true);INSERT INTO hoa_assets VALUES(1,1,1);INSERT INTO captures VALUES(1,1);`);
 await db.query(SCHEMA);await db.query(SCHEMA);
 const app=express();app.use(express.json());register(app,{pool:db,requireAuth:(req,res,next)=>{req.user={id:1};next();},requireHoa:(req,res,next)=>{req.hoaCompany={id:1};next();},currentProduct:async()=> 'property'});server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const post=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 assert.equal((await post('/api/property/areas',{community_id:1,name:' '})).status,400);
 const a=await post('/api/property/areas',{community_id:1,name:'North Parking Lot',description:'Main Street'});assert.equal(a.status,200);const id=a.body.id;
 assert.equal((await post('/api/property/areas',{community_id:1,name:'north parking lot'})).status,409);
 assert.equal((await post('/api/property/areas',{community_id:2,name:'North Parking Lot'})).status,200);
 assert.equal((await post('/api/property/areas',{community_id:3,name:'Unauthorized'})).status,404);
 assert.equal((await post('/api/property/associations/asset/1',{property_area_id:id})).status,200);
 await assert.rejects(validate(db,1,2,id),{status:400});
 assert.equal((await post('/api/property/areas/'+id,{name:'North Parking Lot',description:'Updated',active:false})).status,200);
 assert.equal((await post('/api/property/associations/asset/1',{property_area_id:id})).status,200);
 assert.equal((await post('/api/property/associations/capture/1',{community_id:1,property_area_id:id})).status,400);
 assert.equal((await db.query('SELECT property_area_id FROM hoa_assets WHERE id=1')).rows[0].property_area_id,id);
 assert.equal((await post('/api/property/associations/asset/1',{property_area_id:''})).status,200);
 assert.equal((await db.query('SELECT property_area_id FROM hoa_assets WHERE id=1')).rows[0].property_area_id,null);
 console.log('PostgreSQL: idempotent schema, isolation, CRUD, duplicate names, inactive history and nullable associations PASS');
 await new Promise(r=>server.close(r));server=null;
 const staticApp=express();staticApp.use(express.static(require('node:path').join(__dirname,'../public')));server=staticApp.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let areas=[{id:1,community_id:1,name:'North Parking Lot',active:true},{id:2,community_id:2,name:'Mechanical Room',active:true},{id:3,community_id:1,name:'Old Entrance',active:false}];
 await page.route('**/api/**',async r=>{const path=new URL(r.request().url()).pathname;let data=[];
 if(path==='/api/me')data={id:1,name:'Test',role:'user',plan:'pro',pro_type:'general',email:'area-fixture@example.test',edition_access:['pro']};
 if(path==='/api/hoa/company')data={id:1,name:'Company',company_role:'administrator'};
 if(path==='/api/hoa/communities')data=[{id:1,name:'Property A'},{id:2,name:'Property B'}];
 if(path==='/api/property/areas')data=areas;
 if(path==='/api/hoa/assets/1')data={asset:{id:1,community_id:1,name:'Light Pole',community_name:'Property A',condition:'good',property_area_id:3},photos:[]};
 if(path==='/api/hoa/items/1')data={item:{id:1,community_id:1,title:'Broken light',community_name:'Property A',area:'Lighting',priority:'routine',status:'new',created_at:new Date().toISOString(),property_area_id:3},history:[],photos:[]};
 if(path==='/api/hoa/dashboard')data={};
 await r.fulfill({json:data});});
 await page.addInitScript(()=>localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed'));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>state.me&&document.getElementById('body'),null,{timeout:10000}).catch(async e=>{console.error({errors,body:(await page.locator('body').innerText()).slice(0,800)});throw e;});await page.evaluate(async()=>{state.plan='pro';state.proType='property';state.view='capture';await loadHoaContext();renderApp();});await page.waitForSelector('#hoaCommunity');
 await page.selectOption('#hoaCommunity','1');await page.waitForSelector('#paCaptureArea option[value="1"]', {state:'attached'});assert.equal(await page.locator('#paCaptureArea option[value="2"]').count(),0);assert.equal(await page.locator('#paCaptureArea option[value="3"]').count(),0);
 await page.selectOption('#hoaCommunity','2');await page.waitForSelector('#paCaptureArea option[value="2"]', {state:'attached'});assert.equal(await page.locator('#paCaptureArea option[value="1"]').count(),0);
 await page.evaluate(()=>renderHoaCommunities());await page.waitForSelector('#paCreate');await page.selectOption('#paProperty','1');assert(await page.locator('#paList').innerText().then(t=>t.includes('Old Entrance')));
 await page.evaluate(()=>renderHoaAssets());await page.waitForSelector('#paAssetFilter');assert.equal(await page.locator('#paAssetArea option[value="1"]').count(),0);assert(await page.locator('#paAssetSearch').isVisible());
 await page.evaluate(()=>renderHoaAsset(1));await page.waitForSelector('#paRecordArea option[value="3"]', {state:'attached'});assert.equal(await page.inputValue('#paRecordArea'),'3');
 await page.evaluate(()=>renderHoaItem(1));await page.waitForSelector('#paSaveAssociation');assert.equal(await page.inputValue('#paRecordArea'),'3');
 await page.evaluate(()=>renderHoaInspections());await page.waitForSelector('#paInspectionFilter');await page.selectOption('#hirCommunity','1');await page.fill('#hirStops','Rear loading dock | overview\nMain entrance');await page.waitForSelector('#paStop1');await page.selectOption('#paStop0','1');await page.locator('.pn-help-fab').click();await page.locator('#pnHelpSearch').fill('Area');assert(await page.locator('.pn-help-article').count()>0);assert((await page.locator('#pnHelpTermsList').innerText()).includes('Property Area'));await page.locator('#pnHelpClose').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:`/tmp/property-areas-${engine.name()}-${width}.png`,fullPage:true});
 await page.evaluate(()=>renderHoaVisits());await page.waitForSelector('#paVisitFilter');
 for(const render of ['renderHoaCommunities','renderHoaAssets','renderHoaInspections','renderHoaMaintenance']){await page.evaluate(name=>{state.proType='hoa';window[name]();},render);await page.waitForTimeout(120);assert.equal(await page.locator('[id^="pa"],[id^="propertyAreas"]').count(),0);}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);await page.close();console.log(`${engine.name()} ${width}: Property controls, optional selection, property switching, historical inactive Areas, route stops and HOA invisibility PASS`);
 }}finally{await browser.close();}}
 }finally{if(server)await new Promise(r=>server.close(r));await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await db.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});

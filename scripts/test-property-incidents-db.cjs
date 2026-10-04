// Isolated PostgreSQL temporary tables, always rolled back. Never loads .env.
const {Client}=require('pg'),express=require('express'),assert=require('node:assert/strict');
const feature=require('../property-incidents');
(async()=>{const db=new Client(process.env.PN_ISOLATED_DATABASE_URL ? {connectionString:process.env.PN_ISOLATED_DATABASE_URL} : {host:'/tmp',database:'postgres'});await db.connect();let server;try{
 await db.query('BEGIN');for(const sql of [
 'CREATE TEMP TABLE users(id INTEGER PRIMARY KEY)',
 'CREATE TEMP TABLE hoa_management_companies(id INTEGER PRIMARY KEY)',
 'CREATE TEMP TABLE hoa_communities(id INTEGER PRIMARY KEY,company_id INTEGER,name TEXT,address TEXT,active BOOLEAN)',
 'CREATE TEMP TABLE hoa_assets(id INTEGER PRIMARY KEY,community_id INTEGER,company_id INTEGER,name TEXT)',
 'CREATE TEMP TABLE captures(id INTEGER PRIMARY KEY,user_id INTEGER,photo_path TEXT,created_at TIMESTAMPTZ DEFAULT now())',
 'CREATE TEMP TABLE property_areas(id INTEGER PRIMARY KEY,community_id INTEGER,name TEXT,active BOOLEAN)',
 feature.SCHEMA.replaceAll('CREATE TABLE IF NOT EXISTS','CREATE TEMP TABLE IF NOT EXISTS'),
 'INSERT INTO users VALUES(1),(2)', 'INSERT INTO hoa_management_companies VALUES(1),(2)',
 "INSERT INTO hoa_communities VALUES(1,1,'Shopping Center','Test Address',true),(2,2,'Other company','Other',true)",
 "INSERT INTO hoa_assets VALUES(1,1,1,'Light Pole #7'),(2,2,2,'Other asset')",
 "INSERT INTO property_areas VALUES(1,1,'North Parking Lot',true)",
 "INSERT INTO captures(id,user_id,photo_path) VALUES(1,1,'/uploads/test.jpg'),(2,1,'/uploads/test.jpg')"
 ])await db.query(sql);
 const app=express();app.use(express.json());feature.register(app,{pool:db,requireAuth:(req,res,next)=>{req.user={id:Number(req.headers['x-user']||1)};next();},requireHoa:(req,res,next)=>{req.hoaCompany={id:1};next();},currentProduct:async id=>id===3?'hoa':'property',report:async(req,res,d)=>res.json(d)});
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/property/incidents`;
 const call=async(path='',body,user=1)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-user':String(user)},body:body&&JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 const b={community_id:1,title:'Pole impact',incident_type:'Vehicle Impact',observed_at:new Date().toISOString(),asset_id:1,property_area_id:1};assert.equal((await call('',{...b,asset_id:2})).status,400);assert.equal((await call('',{...b,community_id:2})).status,400);assert.equal((await call('',undefined,3)).status,403);
 const created=await call('',b);assert.equal(created.status,200);assert.equal(created.data.area_name,'North Parking Lot');const id=created.data.id;assert.equal((await call('/'+id,undefined,2)).status,404);
 for(const [captureId,view] of [[1,'Overview'],[2,'Damage']])await feature.linkCapture(db,{userId:1,companyId:1,incidentId:id,captureId,view,product:'property',hasPhoto:true});
 const d=(await call('/'+id)).data;assert.equal(d.photos.length,2);assert.equal(d.incident.asset_name,'Light Pole #7');assert.equal((await call('/'+id,{...d.incident,status:'Documented',skipped_views:{Identification:'No readable identifier'}})).status,200);
 await db.query('SAVEPOINT bad_link');await assert.rejects(feature.linkCapture(db,{userId:1,companyId:1,incidentId:id,captureId:1,view:'Damage',product:'property',hasPhoto:true}));await db.query('ROLLBACK TO SAVEPOINT bad_link');
 assert.equal((await call('',{...b,property_area_id:null,area_name:'North Parking Lot (description)'})).status,200);
 console.log('PASS: real PostgreSQL schema, ownership, edition gate, Property/asset/Area validation, grouped photos, update and duplicate protection');
 }finally{server?.close();await db.query('ROLLBACK');await db.end();}})().catch(e=>{console.error(e);process.exitCode=1;});

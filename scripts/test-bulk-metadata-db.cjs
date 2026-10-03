const assert=require('node:assert/strict'),{Pool}=require('pg'),express=require('express'),{createHandler,snapshot}=require('../bulk-metadata');
(async()=>{
 const admin=new Pool({connectionString:process.env.BULK_TEST_DATABASE_URL||'postgresql://localhost/postgres'}),schema='bulk_test_'+Date.now();
 await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString:process.env.BULK_TEST_DATABASE_URL||'postgresql://localhost/postgres',options:`-c search_path=${schema}`});let server;
 try{
 await pool.query(`CREATE TABLE jobs(id int PRIMARY KEY,user_id int);CREATE TABLE captures(id int PRIMARY KEY,user_id int,photo_path text,area_tags text[],job_id int,urgency text,favorite boolean DEFAULT false,flagged boolean DEFAULT false,paving_photo_reason text,note text,address text,latitude float);CREATE TABLE capture_history(capture_id int,user_id int,action text,detail jsonb);INSERT INTO jobs VALUES(7,1),(8,2);INSERT INTO captures SELECT i,CASE WHEN i=501 THEN 2 ELSE 1 END,'/photo',ARRAY['Old'],'7','standard',false,false,null,'unique note '||i,'original address',i FROM generate_series(1,501) i;`);
 let edition='paving';await pool.query(`ALTER TABLE captures ADD COLUMN concrete_element text; ALTER TABLE captures ADD COLUMN concrete_stage text DEFAULT 'placement'`);
 const app=express();app.use(express.json());app.post('/api/captures/batch',(req,res,next)=>{req.user={id:1};next();},createHandler({pool,currentProduct:async()=> edition}));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const request=async(body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/captures/batch`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 const ids=Array.from({length:500},(_,i)=>i+1),metadata={area_tags:['New'],urgency:'urgent',job_id:null,paving_photo_reason:'proposal',favorite:true,flagged:true},preview=await request({ids,metadata,preview:true});assert.equal(preview.status,200);
 const denied=await request({ids:[1,501],metadata,preview:true});assert.equal(denied.status,404);assert.equal(denied.body.updated,0);
 assert.equal((await request({ids:[1],metadata:{job_id:8},preview:true})).status,400);
 const applied=await request({ids,metadata,snapshot:preview.body.snapshot});assert.equal(applied.body.updated,500);assert.equal(applied.body.not_updated,0);
 const row=(await pool.query('SELECT * FROM captures WHERE id=1')).rows[0];assert.equal(row.note,'unique note 1');assert.equal(row.address,'original address');assert.equal(row.latitude,1);assert.deepEqual(row.area_tags,['New']);assert.equal(row.job_id,null);
 assert.equal((await pool.query('SELECT count(*)::int n FROM capture_history')).rows[0].n,500);
 const detail=(await pool.query('SELECT detail FROM capture_history LIMIT 1')).rows[0].detail;assert(detail.bulk);assert.deepEqual(detail.before.area_tags,['Old']);
 assert.equal((await request({ids,metadata,snapshot:preview.body.snapshot})).status,409);
 const clear={area_tags:[]},p=await request({ids:[1,2],metadata:clear,preview:true});assert.equal((await request({ids:[1,2],metadata:clear,snapshot:p.body.snapshot})).body.updated,2);
 edition='concrete';const cm={concrete_element:'foundation'},cp=await request({ids:[1,2],metadata:cm,preview:true});assert.equal((await request({ids:[1,2],metadata:cm,snapshot:cp.body.snapshot})).body.updated,2);assert.equal((await pool.query('SELECT concrete_stage FROM captures WHERE id=1')).rows[0].concrete_stage,'placement');
 // A history failure must undo the metadata UPDATE too.
 await pool.query(`CREATE FUNCTION reject_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test history failure'; END $$;CREATE TRIGGER reject_history BEFORE INSERT ON capture_history FOR EACH ROW EXECUTE FUNCTION reject_history();`);
 const m={urgency:'standard'},pv=await request({ids:[1],metadata:m,preview:true});assert.equal((await request({ids:[1],metadata:m,snapshot:pv.body.snapshot})).status,503);assert.equal((await pool.query('SELECT urgency FROM captures WHERE id=1')).rows[0].urgency,'urgent');
 console.log('Bulk metadata PostgreSQL integration passed: 500 photos, ownership, job access, evidence preservation, history, clears, stale preview, rollback.');
 }finally{await new Promise(r=>server?server.close(r):r());await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});

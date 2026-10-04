// Synthetic dependency preview, with temporary tables and transaction rollback.
const assert=require('node:assert/strict'),{Client}=require('pg');
const {deletionPreview}=require('../user-deletion');
(async()=>{const db=new Client(process.env.PN_ISOLATED_DATABASE_URL?{connectionString:process.env.PN_ISOLATED_DATABASE_URL}:{host:'/tmp',database:'postgres'});await db.connect();try{
 await db.query('BEGIN');
 await db.query(`CREATE TEMP TABLE users(id integer,name text,email text,role text,active boolean);
 CREATE TEMP TABLE captures(id integer,user_id integer);
 CREATE TEMP TABLE groups(id integer,user_id integer);
 CREATE TEMP TABLE issue_reports(user_id integer);
 CREATE TEMP TABLE testing_assignments(user_id integer);
 CREATE TEMP TABLE hoa_maintenance_items(created_by integer,capture_id integer);
 CREATE TEMP TABLE hoa_property_visits(created_by integer);
 CREATE TEMP TABLE hoa_completion_photo_requests(created_by integer);
 CREATE TEMP TABLE hoa_company_members(user_id integer,company_id integer);
 CREATE TEMP TABLE hoa_item_photos(capture_id integer);
 CREATE TEMP TABLE hoa_asset_photos(capture_id integer);
 CREATE TEMP TABLE hoa_assets(primary_capture_id integer);
 CREATE TEMP TABLE hoa_visit_stops(capture_ids integer[]);
 CREATE TEMP TABLE group_items(capture_id integer,group_id integer);
 CREATE TEMP TABLE property_incidents(created_by integer);
 INSERT INTO users VALUES(1,'Fixture','fixture@example.test','user',true),(2,'Other','other@example.test','user',true);
 INSERT INTO property_incidents VALUES(1);`);
 assert.match((await deletionPreview(db,1,99)).blocked,/records still depend/,'Incident creator deletion must be blocked before destructive work starts');
 assert.equal((await deletionPreview(db,2,99)).blocked,null,'An unrelated incident must not block another account');
 assert.equal((await db.query('SELECT count(*)::int n FROM property_incidents')).rows[0].n,1,'Preview preserves incident evidence');
 console.log('Incident deletion preview: dependency block, unrelated account and evidence preservation PASS');
}finally{await db.query('ROLLBACK');await db.end();}})().catch(e=>{console.error(e);process.exitCode=1;});

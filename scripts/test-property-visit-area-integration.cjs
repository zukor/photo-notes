// Read the actual handler query. Synthetic temporary tables are always rolled back.
const fs=require('node:fs'),assert=require('node:assert/strict'),{Client}=require('pg');
(async()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../server.js'),'utf8');
 const start=source.indexOf("app.post('/api/hoa/visits/:visitId/stops/:stopId'");
 assert(start>=0);
 const handler=source.slice(start,source.indexOf('\n',start));
 const query=handler.match(/pool\.query\(`(SELECT s\.\*[\s\S]*?)`,\[stopId,visitId,req\.hoaCompany\.id\]/)?.[1];
 assert(query,'Visit handler query must be found');
 const db=new Client({host:'/tmp',database:'postgres'});
 await db.connect();
 try{
  await db.query('BEGIN');
  await db.query('CREATE TEMP TABLE property_areas(id integer primary key,name text); CREATE TEMP TABLE hoa_property_visits(id integer primary key,company_id integer,community_id integer); CREATE TEMP TABLE hoa_visit_stops(id integer primary key,visit_id integer,property_area_id integer); CREATE TEMP TABLE captures(id integer primary key,property_area_id integer,property_community_id integer); INSERT INTO property_areas VALUES(3,\'Equipment\'); INSERT INTO hoa_property_visits VALUES(4,5,6); INSERT INTO hoa_visit_stops VALUES(7,4,3); INSERT INTO captures VALUES(8,NULL,NULL)');
  assert.equal((await db.query(query,[7,4,99])).rowCount,0,'Other companies cannot select this stop');
  const row=(await db.query(query,[7,4,5])).rows[0];
  assert.equal(row.community_id,6,'Visit photo must inherit its Property, alongside its Area');
  await db.query('UPDATE captures SET property_area_id=$1,property_community_id=$2 WHERE id=$3',[row.property_area_id,row.community_id,8]);
  assert.deepEqual((await db.query('SELECT property_area_id,property_community_id FROM captures WHERE id=8')).rows[0],{property_area_id:3,property_community_id:6});
  console.log('Property visit upload: company isolation and Property/Area metadata PASS');
 }finally{await db.query('ROLLBACK');await db.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});

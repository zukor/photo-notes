const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {validate,registerPhotoMarkers,SCHEMA}=require('../photo-markers');
test('marker validation accepts only explicit booleans and safe saved photo IDs',()=>{assert.deepEqual(validate({ids:[1,1],favorite:true}),{ids:[1],keys:['favorite']});for(const body of [{ids:[],favorite:true},{ids:[1],favorite:'true'},{ids:[0],flagged:true},{ids:[1],priority:'urgent'},{ids:[1]},{ids:[2147483648],flagged:true}])assert.equal(validate(body),null);assert.match(SCHEMA,/DEFAULT false/);});
test('marker endpoint gates editions, scopes ownership and rolls back mixed ownership',async()=>{
 let edition='basic',owned=[{id:1}],queries=[];
 const db={query:async(sql,values)=>{queries.push({sql,values});return {rows:sql.startsWith('SELECT')?owned:sql.startsWith('UPDATE')?[{id:1,favorite:true,flagged:false}]:[]};},release(){}};
 const app=express();app.use(express.json());registerPhotoMarkers(app,{pool:{connect:async()=>db},requireAuth:(req,res,next)=>{req.user={id:7};next();},currentProduct:async()=>edition});const server=app.listen(0);await new Promise(r=>server.once('listening',r));
 try{const send=body=>fetch(`http://127.0.0.1:${server.address().port}/api/photo-markers`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await send({ids:[1],favorite:true})).status,403);assert.equal(queries.length,0);
 for(edition of ['general','paving','concrete','property','hoa','contractor','roofer']){queries=[];assert.equal((await send({ids:[1],favorite:true})).status,200);assert.match(queries[1].sql,/user_id=\$1/);assert.deepEqual(queries[1].values,[7,[1]]);assert.match(queries[2].sql,/SET favorite=\$3 WHERE user_id=\$1/);assert.doesNotMatch(queries[2].sql,/urgency|priority|note|history/);}
 owned=[];queries=[];assert.equal((await send({ids:[1],flagged:true})).status,404);assert.equal(queries.at(-1).sql,'ROLLBACK');assert(!queries.some(q=>q.sql.startsWith('UPDATE')));
 }finally{server.close();}
});

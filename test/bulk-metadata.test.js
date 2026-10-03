const {test}=require('node:test'),assert=require('node:assert/strict');
const {EDITIONS,fieldsFor,validate,snapshot,createHandler}=require('../bulk-metadata');
test('only Pro editions expose safe registry',()=>{
 for(const e of ['general','pro','paving','concrete','property','hoa','contractor','roofer'])assert(EDITIONS.has(e));
 for(const e of ['basic','issue','roads'])assert(!EDITIONS.has(e));
 for(const e of EDITIONS){assert.deepEqual(Object.keys(fieldsFor(e)).slice(0,3),['area_tags','job_id','urgency']);for(const key of ['note','address','latitude','captured_at','concrete_condition','severity','approval','property_area_id','favorite'])assert(!fieldsFor(e)[key]);}
 assert(fieldsFor('paving').paving_photo_reason);assert(!fieldsFor('concrete').paving_photo_reason);
});
test('explicit changes, strict IDs, clears and no silent truncation',()=>{
 assert.deepEqual(validate({ids:[1,1,2],metadata:{area_tags:[],job_id:null,urgency:'standard'}},'general').ids,[1,2]);
 for(const b of [{ids:['1'],metadata:{urgency:'urgent'}},{ids:[1],metadata:{}},{ids:[1],metadata:{note:'destroy'}},{ids:[1],metadata:{urgency:null}},{ids:Array.from({length:501},(_,i)=>i+1),metadata:{urgency:'urgent'}},{ids:[1],metadata:{job_id:0}},{ids:[1],metadata:{area_tags:['']}},{ids:[1],metadata:{urgency:'urgent'},note:'bad'}])assert.throws(()=>validate(b,'general'));
 assert.equal(validate({ids:[1],metadata:{paving_photo_reason:null}},'paving').metadata.paving_photo_reason,null);
 assert.throws(()=>validate({ids:[1],metadata:{paving_photo_reason:'proposal'}},'hoa'));
});
test('preview conflict detection ignores unrelated fields but detects selected fields',()=>{
 const rows=[{id:1,urgency:'standard',note:'original'}],m={urgency:'urgent'};
 assert.equal(snapshot(rows,m),snapshot([{...rows[0],note:'new'}],m));assert.notEqual(snapshot(rows,m),snapshot([{...rows[0],urgency:'urgent'}],m));
});
function harness(rows,{edition='general',failHistory=false}={}){
 const calls=[],db={release(){calls.push('release');},async query(sql,vals){calls.push(sql);if(sql.startsWith('SELECT id,'))return {rows};if(sql.startsWith('SELECT id FROM jobs'))return {rowCount:vals[0]===7?1:0};if(failHistory&&sql.startsWith('INSERT'))throw Error('history failed');return {rows:[],rowCount:rows.length};}};
 const handler=createHandler({pool:{connect:async()=>db},currentProduct:async()=>edition});
 return {calls,async run(body){const result={status:200};await handler({user:{id:1},body},{status(n){result.status=n;return this;},json(value){result.body=value;return this;}});return result;}};
}
test('unauthorized/missing selection blocks all writes and history',async()=>{const h=harness([{id:1,urgency:'standard'}]);const r=await h.run({ids:[1,2],metadata:{urgency:'urgent'},preview:true});assert.equal(r.status,404);assert.equal(r.body.updated,0);assert.equal(r.body.not_updated,2);assert(!h.calls.some(s=>s.startsWith('UPDATE')||s.startsWith('INSERT')));assert(h.calls.includes('ROLLBACK'));});
test('Basic rejected before database access',async()=>{const h=harness([],{edition:'basic'});assert.equal((await h.run({ids:[1],metadata:{urgency:'urgent'}})).status,403);assert.equal(h.calls.length,0);});
test('preview performs no writes; apply uses a single update and history insertion',async()=>{const h=harness([{id:1,urgency:'standard'},{id:2,urgency:'urgent'}]);const body={ids:[1,2],metadata:{urgency:'urgent'}};const preview=await h.run({...body,preview:true});assert.equal(preview.body.count,2);assert(!h.calls.some(s=>s.startsWith('UPDATE')));const result=await h.run({...body,snapshot:preview.body.snapshot});assert.equal(result.body.updated,1);assert.equal(result.body.unchanged,1);assert.equal(h.calls.filter(s=>s.startsWith('UPDATE')).length,1);assert.equal(h.calls.filter(s=>s.startsWith('INSERT')).length,1);});
test('history failure rolls back and reports zero successes',async()=>{const rows=[{id:1,urgency:'standard'}],h=harness(rows,{failHistory:true}),metadata={urgency:'urgent'};const result=await h.run({ids:[1],metadata,snapshot:snapshot(rows,metadata)});assert.equal(result.status,503);assert.equal(result.body.updated,0);assert(h.calls.includes('ROLLBACK'));});
test('stale review and inaccessible job reject atomically',async()=>{const h=harness([{id:1,urgency:'standard',job_id:null}]);assert.equal((await h.run({ids:[1],metadata:{urgency:'urgent'},snapshot:'stale'})).status,409);assert.equal((await h.run({ids:[1],metadata:{job_id:9},preview:true})).status,400);assert(!h.calls.some(s=>s.startsWith('UPDATE')));});
test('500 selection uses fixed number of database requests',async()=>{const rows=Array.from({length:500},(_,i)=>({id:i+1,urgency:'standard'})),h=harness(rows),metadata={urgency:'urgent'};const result=await h.run({ids:rows.map(r=>r.id),metadata,snapshot:snapshot(rows,metadata)});assert.equal(result.body.updated,500);assert.equal(h.calls.length,6);});

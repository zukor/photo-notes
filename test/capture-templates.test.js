const {test}=require('node:test'),assert=require('node:assert/strict');
const {sanitize,register}=require('../capture-templates');
test('templates exclude evidence and isolate specialty fields',()=>{
 const unsafe={topic:'Pavement',urgency:'urgent',note:'damaged',latitude:42,address:'site',created_at:'yesterday',job_id:5,photo:'file',concreteCondition:'unsafe',concreteSeverity:'critical',hoaType:'inspection',concretePhase:'work',concretePurpose:'work_problem',concreteElement:'patio',pavingPhotoReason:'ticket'};
 assert.deepEqual(sanitize('pro',null),{});
 assert.deepEqual(sanitize('pro',unsafe),{topic:'Pavement',urgency:'urgent'});
 assert.equal(sanitize('concrete',unsafe).concreteCondition,undefined);
 assert.equal(sanitize('paving',unsafe).pavingPhotoReason,undefined);
 assert.equal(sanitize('hoa',unsafe).hoaType,'inspection');
 assert.equal(sanitize('concrete',{concretePhase:'invalid',concretePurpose:'work_problem'}).concretePurpose,undefined);
});
test('server queries and updates use authenticated account, reject free accounts',async()=>{
 const routes={},queries=[];register({get:(p,...h)=>routes.get=h,put:(p,...h)=>routes.put=h},{requireAuth:(req,res,next)=>next(),pool:{query:async(sql,params)=>{queries.push({sql,params});return {rows:[]};}}});
 let status;const res={status:n=>(status=n,res),json:x=>x};
 routes.get[1]({user:{plan:'free'}},res,()=>assert.fail());assert.equal(status,403);
 await routes.get[2]({user:{id:77}},res);assert.deepEqual(queries[0].params,[77]);assert.match(queries[0].sql,/WHERE user_id=\$1/);
 await routes.put[2]({user:{id:77,pro_type:'general'},params:{id:'11111111-1111-4111-8111-111111111111'},body:{edition:'hoa',name:'Other'}},res);assert.equal(status,403);assert.equal(queries.length,1);
});

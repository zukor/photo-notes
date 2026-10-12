const test=require('node:test'),assert=require('node:assert/strict');
const {validate,CATEGORIES,register}=require('../customer-feedback');
test('customer categories map to existing issue types and retain trusted organization',async()=>{
 for(const [category,type] of Object.entries(CATEGORIES)){
 const req={user:{id:9},body:{feedback_category:category,organization:'spoofed',testing_assignment_id:1},files:{}};
 const feedback=await validate({query:async(sql,values)=>{assert.deepEqual(values,[9]);return {rows:[{enabled:true,organization:'Mission Asphalt'}]};}},req);
 assert.deepEqual(feedback,{category,organization:'Mission Asphalt'});assert.equal(req.body.issue_type,type);assert.equal(req.body.testing_assignment_id,undefined);
 }
 assert.equal(await validate({}, {body:{}}),null);
});
test('disabled access, unknown categories and extra attachments are rejected',async()=>{
 await assert.rejects(()=>validate({query:async()=>({rows:[]})},{user:{id:1},body:{feedback_category:'idea'}}),e=>e.status===403);
 for(const category of ['invalid','toString','__proto__'])await assert.rejects(()=>validate({}, {body:{feedback_category:category}}),e=>e.status===400);
 await assert.rejects(()=>validate({}, {body:{feedback_category:'idea'},files:{voice:[{}]}}),e=>e.status===400);
});
test('regular admin can review feedback but cannot configure accounts',async()=>{
 const express=require('express'),app=express();app.use(express.json());let queries=0;
 const auth=(req,res,next)=>{req.user={id:2,role:'admin'};next();};
 register(app,{pool:{query:async()=>{queries++;return {rows:[]};}},requireAuth:auth,requireAdmin:auth});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const url='http://127.0.0.1:'+server.address().port;const response=await fetch(url+'/api/admin/customer-feedback');assert.equal(response.status,200);const data=await response.json();assert.deepEqual(data.accounts,[]);assert.equal(data.can_manage,false);assert.equal((await fetch(url+'/api/admin/customer-feedback/1',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"enabled":true}'})).status,403);assert.equal(queries,1);}finally{await new Promise(r=>server.close(r));}
});

test('review access includes internal testing managers and excludes customer users',()=>{
 const {canReview}=require('../customer-feedback');assert.equal(canReview({role:'user',is_testing_manager:true}),true);assert.equal(canReview({role:'admin'}),true);assert.equal(canReview({role:'user'}),false);assert.equal(canReview(null),false);
});

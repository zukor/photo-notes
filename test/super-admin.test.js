const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {isSuperAdmin,adminAccessBoundary}=require('../super-admin');
const env={SUPER_ADMIN_USER_IDS:'1'};
test('Super Admin requires a configured immutable user ID and current admin role',()=>{
 assert(isSuperAdmin({id:1,role:'admin'},env));
 for(const user of [null,{id:2,role:'admin',is_super_admin:true},{id:1,role:'user'}])assert.equal(isSuperAdmin(user,env),false);
 assert.equal(isSuperAdmin({id:1,role:'admin'},{}),false);
});
test('sensitive admin routes and owner account operations reject direct regular-admin requests',async t=>{
 const app=express();app.use(express.json());
 app.use('/api/admin',(req,res,next)=>{req.user={id:Number(req.get('test-user')||2),role:'admin'};next();},adminAccessBoundary(env));
 app.use((req,res)=>res.json({ok:true}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 for(const path of ['/issues','/issues/3','/issues/3/retry-email','/issues/3/mark-tester-notified','/health','/HEALTH/','/activity','/billing/status','/billing/invoices','/repair-status','/cloud-worker','/users/1','/users/1/password','/users/1/versions','/users/1/deletion']){
  for(const method of ['GET','POST','DELETE']){
   assert.equal((await fetch(base+'/api/admin'+path,{method})).status,403,method+' '+path);
   assert.equal((await fetch(base+'/api/admin'+path,{method,headers:{'test-user':'1'}})).status,200,'owner '+path);
   assert.equal((await fetch(base+'/api/admin'+path,{method,headers:{'test-user':'1','X-Photo-Notes-Admin-View':'regular'}})).status,403,'regular view '+path);
  }
 }
 for(const path of ['/users','/users/2','/users/2/password','/usage','/testing/assignments'])assert.equal((await fetch(base+'/api/admin'+path)).status,200,path);
 for(const path of ['/users','/users/2','/users/2/password','/users/2/versions','/users/2/future-setting']){
  for(const method of ['POST','PATCH','PUT','DELETE']){
   const allowed=path==='/users/2/versions'&&method==='POST';
   assert.equal((await fetch(base+'/api/admin'+path,{method})).status,allowed?200:403,method+' '+path);
   assert.equal((await fetch(base+'/api/admin'+path,{method,headers:{'test-user':'1'}})).status,200);
  }
 }
 assert.equal((await fetch(base+'/api/admin/users/2/deletion')).status,403);
 assert.equal((await fetch(base+'/api/admin/users/2',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({is_super_admin:true})})).status,403);
});
test('server mounts the boundary before sensitive routes and exposes server-derived membership',()=>{
 const source=require('node:fs').readFileSync(require.resolve('../server.js'),'utf8');
 assert(source.indexOf("app.use('/api/admin',requireAuth,adminAccessBoundary())")<source.indexOf('registerStripeRoutes(app,'));
 assert.match(source,/is_super_admin:isSuperAdmin\(req.user\)/);
 assert.match(source,/is_super_admin:isSuperAdmin\(user\)/);
});

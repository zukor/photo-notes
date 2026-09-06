const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('server.js','utf8');
function run(user){
  const ctx=vm.createContext({readUser:()=>({id:1,role:'admin'}),pool:{query:async()=>({rows:user?[user]:[]})}});
  vm.runInContext(source.slice(source.indexOf('async function requireAuth'),source.indexOf('function requireTestingQueueToken')),ctx);
  return ctx;
}
function response(){return {statusCode:200,status(code){this.statusCode=code;return this},json(body){this.body=body;return this}}}
test('deactivated accounts cannot use an existing session',async()=>{
  const ctx=run({id:1,active:false,role:'admin'}),res=response();let called=false;
  await ctx.requireAuth({},res,()=>called=true);assert.equal(res.statusCode,401);assert.equal(called,false);
});
test('administrator access is checked against the current user record, not stale cookie roles',async()=>{
  const ctx=run({id:1,active:true,role:'user'}),res=response();let called=false;
  await ctx.requireAdmin({},res,()=>called=true);assert.equal(res.statusCode,403);assert.equal(called,false);
});
test('active administrators retain access',async()=>{
  const ctx=run({id:1,active:true,role:'admin'}),res=response();let called=false;
  await ctx.requireAdmin({},res,()=>called=true);assert.equal(called,true);
});
test('new users can receive multiple versions at creation without changing their role',async()=>{
  let handler,saved;
  const ctx=vm.createContext({
    app:{post:(url,middleware,fn)=>handler=fn},requireAdmin(){},
    validateEditions:require('../editions').validateEditions,EDITIONS:require('../editions').EDITIONS,
    bcrypt:{hashSync:()=> 'test-only-hash'},seedUserAreas:async()=>{},logEvent(){},
    pool:{query:async(sql,params)=>{saved={sql,params};return {rows:[{id:9}]};}}
  });
  const a=source.indexOf("app.post('/api/admin/users',"),b=source.indexOf("app.post('/api/admin/users/:id',",a);
  vm.runInContext(source.slice(a,b),ctx);
  const res=response();
  await handler({user:{id:1},body:{name:'Test Person',email:'test@example.test',password:'fixture-only',edition_access:['basic','pro','concrete']}},res);
  assert.equal(res.statusCode,200);assert.match(saved.sql,/edition_access/);
  assert.deepEqual(Array.from(saved.params[6]),['basic','pro','concrete']);
  assert.equal(saved.params[4],'free');assert.equal(saved.params[5],'general');assert.match(saved.sql,/'user'/);
});

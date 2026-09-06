const test=require('node:test'),assert=require('node:assert/strict');
const {EDITIONS,editionAccess,validateEditions,registerEditionRoutes}=require('../editions');
test('existing users retain their current version and administrators retain their existing versions',()=>{
  assert.deepEqual(editionAccess({plan:'free',pro_type:'general'}),['basic']);
  assert.deepEqual(editionAccess({plan:'pro',pro_type:'concrete'}),['concrete']);
  assert.deepEqual(editionAccess({role:'admin',plan:'free'}),Object.keys(EDITIONS));
  assert.deepEqual(editionAccess({role:'admin',edition_access:['basic']}),['basic']);
});
test('version lists reject empty, unknown, and prototype keys',()=>{
  for(const value of [[],null,'pro',['unknown'],['__proto__'],['constructor']])assert.equal(validateEditions(value),null);
  assert.deepEqual(validateEditions(['basic','pro','concrete','pro']),['basic','pro','concrete']);
});
function harness(user){
  const routes={},writes=[],events=[];
  const record={active:true,role:'user',id:4,plan:'free',pro_type:'general',...user};
  const pool={connect:async()=>({
    async query(sql,args){
      if(sql.startsWith('SELECT'))return {rows:[{...record}]};
      if(sql.startsWith('UPDATE users SET edition_access')){record.edition_access=args[0];record.plan=args[1];record.pro_type=args[2];writes.push(sql);}
      else if(sql.startsWith('UPDATE users SET plan')){record.plan=args[0];record.pro_type=args[1];writes.push(sql);return {rows:[{...record}]};}
      return {rows:[]};
    },release(){}
  })};
  const auth=()=>{},admin=()=>{};
  registerEditionRoutes({post:(url,...handlers)=>routes[url]=handlers},{pool,requireAuth:auth,requireAdmin:admin,setSession:()=>{},logEvent:async(...args)=>events.push(args)});
  async function call(url,body){const result={code:200,status(code){this.code=code;return this},json(value){this.body=value;return this}};await routes[url].at(-1)({user:{id:4},params:{id:'4'},body},result);return result;}
  return {record,writes,events,routes,admin,call};
}
test('ordinary users can switch among granted versions but cannot select an ungranted version',async()=>{
  const h=harness({edition_access:['basic','pro','concrete']});
  assert.equal((await h.call('/api/switch-edition',{edition:'concrete'})).code,200);
  assert.equal(h.record.pro_type,'concrete');
  assert.equal((await h.call('/api/switch-edition',{edition:'hoa'})).code,403);
  assert.equal(h.record.pro_type,'concrete');assert.equal(h.writes.length,1);
});
test('removing the selected version moves the account to a remaining granted version',async()=>{
  const h=harness({plan:'pro',pro_type:'concrete',edition_access:['basic','pro','concrete']});
  const result=await h.call('/api/admin/users/:id/versions',{edition_access:['basic','pro']});
  assert.equal(result.code,200);assert.deepEqual(h.record.edition_access,['basic','pro']);assert.equal(h.record.plan,'free');
  assert.equal((await h.call('/api/switch-edition',{edition:'concrete'})).code,403);
  assert.equal(h.routes['/api/admin/users/:id/versions'][0],h.admin);
});
test('saving versions preserves the selected version when it is still allowed',async()=>{
  const h=harness({plan:'pro',pro_type:'concrete'});
  await h.call('/api/admin/users/:id/versions',{edition_access:['basic','pro','concrete']});
  assert.equal(h.record.pro_type,'concrete');assert.equal(h.record.plan,'pro');assert.equal(h.events.length,1);
});
test('deactivated accounts and invalid versions cannot switch',async()=>{
  const h=harness({active:false,edition_access:['basic','pro']});
  assert.equal((await h.call('/api/switch-edition',{edition:'pro'})).code,403);
  assert.equal((await h.call('/api/switch-edition',{edition:'__proto__'})).code,400);
  assert.equal(h.writes.length,0);
});

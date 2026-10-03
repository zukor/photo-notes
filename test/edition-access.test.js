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

test('Property Manager Pro keeps its identity through assignment and switching',async()=>{
  const {currentEdition}=require('../editions');
  const h=harness({edition_access:['hoa','property']});
  assert.equal((await h.call('/api/switch-edition',{edition:'property'})).code,200);
  assert.equal(h.record.plan,'pro');
  assert.equal(currentEdition(h.record),'property');
  assert.equal((await h.call('/api/switch-edition',{edition:'hoa'})).code,200);
  assert.equal(currentEdition(h.record),'hoa');
  const denied=harness({edition_access:['hoa']});
  assert.equal((await denied.call('/api/switch-edition',{edition:'property'})).code,403);
});

test('Issue Reporter is a free edition with its own persisted identity',()=>{
  const {EDITIONS,currentEdition}=require('../editions');
  assert.deepEqual(EDITIONS.issue,{plan:'free',pro_type:'issue',label:'Issue Reporter'});
  assert.equal(currentEdition({plan:'free',pro_type:'issue'}),'issue');
  assert.deepEqual(validateEditions(['basic','issue']),['basic','issue']);
});
test('authorized accounts can switch to Issue Reporter and back to Basic',async()=>{
  const h=harness({edition_access:['basic','issue']});
  const issue=await h.call('/api/switch-edition',{edition:'issue'});
  assert.equal(issue.code,200);assert.equal(h.record.plan,'free');assert.equal(h.record.pro_type,'issue');
  const basic=await h.call('/api/switch-edition',{edition:'basic'});
  assert.equal(basic.code,200);assert.equal(h.record.pro_type,'general');
});



test('Testing Hub offers every current edition in its shared version controls',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('public/testing-hub.js','utf8');
 const context={};vm.runInNewContext(source.match(/const editionNames=([^\n]+)/)[0]+';this.names=editionNames;',context);
 for(const [edition,details] of Object.entries(require('../editions').EDITIONS))assert.equal(context.names[edition],details.label);
 assert.equal((source.match(/Object.keys\(editionNames\).map/g)||[]).length,2);
});

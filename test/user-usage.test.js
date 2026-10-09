const test=require('node:test'),assert=require('node:assert/strict');
const {registerUserUsage}=require('../user-usage');
const {adminAccessBoundary}=require('../super-admin');
function fixture(){const routes={};const queries=[];registerUserUsage({post:(p,...h)=>routes[p]=h,get:(p,...h)=>routes[p]=h},{pool:{query:async(sql,args)=>{queries.push({sql,args});return {rows:[]};}},requireAuth:()=>{},requireAdmin:()=>{}});return {routes,queries};}
function response(){return {code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}};}
test('usage pulse derives user identity and strips content',async()=>{const {routes,queries}=fixture(),res=response();await routes['/api/usage/pulse'].at(-1)({user:{id:12},body:{user_id:99,screen:'capture',edition:'property',session:'00000000-0000-0000-0000-000000000000',seconds:20,visit:true,note:'secret'}},res);assert.equal(res.code,200);assert.equal(queries[0].args[0],12);assert.equal(queries[0].args[1].includes('secret'),false);});
test('usage rejects unbounded time and arbitrary screen content',async()=>{for(const patch of [{seconds:31},{screen:'private customer / name'}]){const {routes,queries}=fixture(),res=response();await routes['/api/usage/pulse'].at(-1)({user:{id:12},body:{screen:'capture',edition:'property',session:'00000000-0000-0000-0000-000000000000',seconds:10,...patch}},res);assert.equal(res.code,400);assert.equal(queries.length,0);}});
test('user usage dashboard is forbidden in regular admin view',()=>{for(const user of [{id:2,role:'admin'},{id:1,role:'admin'}]){const res=response();adminAccessBoundary({SUPER_ADMIN_USER_IDS:'1'})({path:'/user-usage',method:'GET',user,get:()=>user.id===1?'regular':null},res,()=>assert.fail('must deny'));assert.equal(res.code,403);}});
test('summary bounds periods and returns content-free activity',async()=>{const {routes,queries}=fixture(),res=response();await routes['/api/admin/user-usage'].at(-1)({query:{days:'999',user:'12'}},res);assert.equal(res.body.days,90);assert.equal(queries.length,5);assert.deepEqual(queries[0].args,[90,12]);assert.ok(!queries[3].sql.includes('e.detail,'));});
const vm=require('node:vm'),fs=require('node:fs');
test('client counts visible activity, excludes idle time, flushes on navigation and resets identity',()=>{
let now=0,timer,events={},sent=[];const document={visibilityState:'visible',addEventListener:(name,fn)=>events[name]=fn};const context={document,window:{addEventListener:(name,fn)=>events[name]=fn},crypto:{randomUUID:()=> '00000000-0000-0000-0000-000000000000'},Date:{now:()=>now},setInterval:fn=>timer=fn,fetch:(url,options)=>{sent.push(JSON.parse(options.body));return Promise.resolve();}};
vm.runInNewContext(fs.readFileSync('public/user-usage.js','utf8'),context);
context.window.PhotoNotesUsage.screen('capture','property',{id:1});assert.equal(sent[0].visit,true);
now=30000;timer();assert.equal(sent.at(-1).seconds,30);
now=60000;timer();now=90000;timer();assert.equal(sent.length,3);
events.pointerdown();now=100000;document.visibilityState='hidden';events.visibilitychange();assert.equal(sent.at(-1).seconds,10);
now=130000;timer();assert.equal(sent.length,4);
document.visibilityState='visible';events.visibilitychange();context.window.PhotoNotesUsage.screen('organize','property',{id:1});assert.equal(sent.at(-1).screen,'organize');
context.window.PhotoNotesUsage.screen(null,null,null);now=140000;timer();assert.equal(sent.length,5);
});

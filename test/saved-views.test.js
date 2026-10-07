const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {validate,SCHEMA,EDITIONS}=require('../saved-views');
test('Saved Views runtime loads before the shared app and is available offline',()=>{
 const index=fs.readFileSync('public/index.html','utf8'),shell=fs.readFileSync('public/sw.js','utf8');
 const runtime=index.indexOf('src="/saved-views.js?'),app=index.indexOf('src="/app.js?');
 assert(runtime>=0&&app>runtime,'Saved Views must initialize before renderers use it');
 assert(shell.includes('/saved-views.js?v=2'));assert(shell.includes('/saved-views.css?v=1'));
});
test('criteria are versioned scalar filter state, never photo snapshots',()=>{
 const body={name:'Drainage',description:'',is_default:false,criteria:{version:1,filters:{search:'drainage',topic:'Exterior',favorite:true,from:'2026-10-01',futureFilter:'ready'}}};
 assert(validate(body));
 for(const change of [{name:''},{is_default:'true'},{description:4},{criteria:{version:2,filters:{}}},{criteria:{version:1,filters:{ids:'1,2'}}},{criteria:{version:1,filters:{topic:['Exterior']}}},{criteria:{version:1,filters:{constructor:'bad'}}}])assert(!validate({...body,...change}));
 assert.match(SCHEMA,/WHERE is_default/);assert.match(SCHEMA,/REFERENCES users\(id\) ON DELETE CASCADE/);
 assert.deepEqual(EDITIONS,['general','paving','concrete','property','hoa','contractor','roofer']);
});
test('Saved Views retain the existing authorized photo search and maintenance endpoints',()=>{
 const src=fs.readFileSync('server.js','utf8');const search=src.slice(src.indexOf("app.get('/api/captures/search'"),src.indexOf('const propertyAreas='));
 assert.match(search,/requireAuth/);assert.match(search,/c\.user_id=\$1/);
 const module=fs.readFileSync('public/saved-views.js','utf8');assert.doesNotMatch(module,/\/api\/captures|\/api\/hoa\/items/);assert.match(module,/s\.run\(\)/);
});
test('an earlier maintenance request cannot replace a newly applied view',async()=>{
 const vm=require('node:vm'),src=fs.readFileSync('public/app.js','utf8');let resolveOld;
 const box={innerHTML:'',querySelectorAll:()=>[]},nodes={hoaItems:box};
 const c={document:{getElementById:id=>nodes[id]},URLSearchParams,PhotoNotesSavedViews:{refresh(){},blocked:()=>false,empty:()=>null},api:()=>new Promise(r=>resolveOld=r)};vm.createContext(c);
 vm.runInContext(src.slice(src.indexOf('let savedViewHoaRequest='),src.indexOf('function hoaItemCard')),c);
 const old=c.loadHoaItems();c.api=async()=>({ok:true,json:async()=>[]});await c.loadHoaItems();const current=box.innerHTML;
 resolveOld({ok:false});await old;assert.equal(box.innerHTML,current);assert.match(current,/No maintenance items match/);
});

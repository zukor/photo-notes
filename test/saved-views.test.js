const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {validate,SCHEMA,EDITIONS}=require('../saved-views');
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

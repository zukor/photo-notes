const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {validateFootprint,footprintSummary,registerConcreteFootprints}=require('../concrete-footprints');
const source=fs.readFileSync('server.js','utf8'),ctx=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function haversineMeters('),source.indexOf('// Which of a user')),ctx);
const compute=ctx.computeZone;
const base={capture_id:10,name:'Backyard patio',points:[],field_length_ft:20,field_width_ft:15,field_method:'tape'};
test('20 by 15 feet gives 300 square feet independent of client area claims',()=>{const d=validateFootprint({...base,field_area_sqft:99999},compute);assert.equal(d.fieldArea,300);assert.equal(d.mapArea,null);});
const lat=29.5,lng=-98.5,rad=Math.PI/180,R=6371000;
const rect=[{lat,lng},{lat,lng:lng+6/(R*Math.cos(lat*rad))/rad},{lat:lat+4/R/rad,lng:lng+6/(R*Math.cos(lat*rad))/rad},{lat:lat+4/R/rad,lng}];
test('map polygon is calculated from coordinates and kept separate from field measurements',()=>{const d=validateFootprint({...base,points:rect,map_area_sqft:99999},compute);assert.ok(Math.abs(d.mapArea-24*10.7639)<.01);assert.equal(d.fieldArea,300);});
test('invalid and crossing outlines, partial measurements, and unknown methods are rejected',()=>{
 for(const patch of [{points:rect.map((p,i)=>i===0?{lat:NaN,lng}:p)},{points:[rect[0],rect[2],rect[1],rect[3]]},{points:[rect[0],rect[0],rect[0]]},{field_width_ft:''},{field_length_ft:-2},{field_method:'guess'},{name:''},{capture_id:0},{points:[{lat:86,lng}]}])assert.throws(()=>validateFootprint({...base,...patch},compute));
 assert.throws(()=>validateFootprint({name:'Empty',capture_id:10},compute));
});
test('map-only and field-only areas are supported and export provenance is explicit',()=>{const d=validateFootprint({name:'Foundation',capture_id:10,points:rect},compute);assert.equal(d.fieldArea,null);const text=footprintSummary({name:'Patio',map_area_sqft:258.3,field_area_sqft:300,field_length_ft:20,field_width_ft:15,field_method:'laser'});assert.match(text,/Map estimate/);assert.match(text,/laser, user entered/);assert.match(text,/300 sq ft \(rectangle\)/);});
function harness({owned=true,found=true}={}){
 const routes={},calls=[],auth=()=>{},concrete=()=>{};
 const pool={async query(sql,args){calls.push({sql,args});if(sql.startsWith('SELECT id FROM captures'))return {rowCount:owned?1:0,rows:[]};return {rowCount:found?1:0,rows:found?[{id:2}]:[]};}};
 registerConcreteFootprints({get:(p,...h)=>routes['GET '+p]=h,post:(p,...h)=>routes['POST '+p]=h},{pool,requireAuth:auth,requireConcrete:concrete,computeZone:compute});
 return {routes,calls,auth,concrete,async call(key,id){const r={code:200,status(c){this.code=c;return this},json(b){this.body=b;return this}};await routes[key].at(-1)({user:{id:7},params:id?{id}: {},body:base},r);return r;}};
}
test('all endpoints require auth and Concrete Pro; foreign photos cannot be linked',async()=>{const h=harness({owned:false});for(const handlers of Object.values(h.routes)){assert.equal(handlers[0],h.auth);assert.equal(handlers[1],h.concrete);}assert.equal((await h.call('POST /api/concrete/footprints')).code,404);assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].args,[10,7]);});
test('update and list are scoped to account and missing area cannot be overwritten',async()=>{const h=harness({found:false});assert.equal((await h.call('POST /api/concrete/footprints/:id','99')).code,404);assert.match(h.calls.at(-1).sql,/WHERE user_id=\$1 AND id=\$11/);assert.equal(h.calls.at(-1).args[0],7);await h.call('GET /api/concrete/footprints');assert.match(h.calls.at(-1).sql,/WHERE f.user_id=\$1/);assert.deepEqual(h.calls.at(-1).args,[7]);});

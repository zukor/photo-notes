const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const server=fs.readFileSync('server.js','utf8'),app=fs.readFileSync('public/app.js','utf8');
const slice=(src,from,to)=>{const a=src.indexOf(from);assert.ok(a>=0,from);const b=src.indexOf(to,a);assert.ok(b>a,to);return src.slice(a,b);};

test('an admin can turn measurements off for Concrete like any other managed feature',async()=>{
  const ctx=vm.createContext({normalizeProType:t=>t,pool:null});
  vm.runInContext(slice(server,'const MANAGED_FEATURES','async function pavingMeasurementsAllowed'),ctx);
  const access=async row=>{ctx.pool={query:async()=>({rows:[row]})};return ctx.currentFeatureAccess(1);};
  assert.equal((await access({plan:'pro',pro_type:'concrete',feature_access:{}})).measurements,true);
  assert.equal((await access({plan:'pro',pro_type:'concrete',feature_access:{measurements:false}})).measurements,false);
  assert.equal((await access({plan:'pro',pro_type:'concrete',feature_access:{}})).ticket_scanner,false);
});

test('pavement classification, map zones and the repair proposal are Paving tools',()=>{
  for(const route of ["'/api/captures/:id/classify'","'/api/captures/classify-batch'","'/api/captures/:id/classify-set'"])assert.match(slice(server,route,'catch'),/pavingMeasurementsAllowed/);
  assert.match(slice(server,"app.get('/api/export/proposal'",'groupId'),/currentProduct\(req\.user\.id\) !== 'paving'/);
});

test('Concrete photo measuring asks about concrete, not pavement',()=>{
  const route=slice(server,"app.post('/api/measure'",'visionJSON(photoPath');
  assert.match(route,/concrete \? 'concrete damage or a concrete work area/);
});

test('card-traced areas are not labeled approximate on screen, matching documents',()=>{
  const ctx=vm.createContext({});vm.runInContext('function trimNumC(v){return String(Math.round(v*100)/100);}\n'+slice(app,'function fmtDimsClient(c)','// ================= end Pro dimension fields'),ctx);
  assert.equal(ctx.fmtDimsClient({dim_length_in:24,dim_length_unit:'in',dim_width_in:12,dim_width_unit:'in',dim_area_sqft:1.6,dim_shape:'irregular',dim_source:'card'}),'24 in x 12 in, 1.6 sq ft');
  assert.match(ctx.fmtDimsClient({dim_area_sqft:1.6,dim_shape:'irregular',dim_source:'photo_ai'}),/approx\. 1\.6 sq ft/);
});

test('Precision Measure and spoken sizes work in Concrete Pro, with concrete wording',()=>{
  assert.match(app,/function precisionMeasureOn\(\)\{return [^}]*measurementOn\(\)/);
  assert.match(app,/isIndustryProClient\(\)&&measurementOn\(\)&&spoken&&/);
  assert.match(app,/PhotoNotesPrecisionMeasure\.open\(\{surface:isConcreteClient\(\)\?'concrete':'paving'/);
  const pm=fs.readFileSync('public/precision-measure.js','utf8');
  assert.match(pm,/concrete:\{thing:'damaged area',surface:'slab'\}/);
});

test('a hard-to-read scanner record needs confirmation in every edition',()=>{
  assert.match(slice(server,"app.post('/api/camera-readings/:id', requireAuth",'changeJob='),/confirmed!==true/);
  assert.match(app,/id="readerConfirm"/);
});

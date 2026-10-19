const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('server.js','utf8');
const slice=(from,to)=>{const a=source.indexOf(from);assert.ok(a>=0,from);const b=source.indexOf(to,a);assert.ok(b>a,to);return source.slice(a,b);};
const tickets=()=>{const ctx=vm.createContext({});vm.runInContext(slice('function ticketText(','async function ownedJobId'),ctx);return ctx;};

test('ticket weights convert to short tons from any printed unit',()=>{
  const c=tickets();
  assert.equal(c.ticketTons(24.5,'tons'),24.5);
  assert.equal(c.ticketTons('48,260','lb'),24.13);
  assert.equal(c.ticketTons(22000,'kg'),24.25);
  assert.equal(c.ticketTons(22,'tonnes'),24.25);
  assert.equal(c.ticketTons(10,'gallons'),null,'an unknown unit is not guessed');
});

test('a decimal comma is a decimal, a thousands comma is not',()=>{
  const c=tickets();
  assert.equal(c.ticketNumber('12,5'),12.5);
  assert.equal(c.ticketNumber('12,50 t'),12.5);
  assert.equal(c.ticketNumber('1,250'),1250);
  assert.equal(c.ticketNumber('1,250.75'),1250.75);
  assert.equal(c.ticketNumber(''),null);
});

test('a missing unit or an impossible weight marks the reading as hard to read',()=>{
  const c=tickets();
  assert.equal(c.scanConfidence({confidence:'high',net_weight:24.5,net_weight_unit:'tons'}),'high');
  assert.equal(c.scanConfidence({confidence:'high',net_weight:24.5,net_weight_unit:null}),'low');
  assert.equal(c.scanConfidence({confidence:'high',net_weight:48260,net_weight_unit:'tons'}),'low');
  assert.equal(c.scanConfidence({confidence:'medium',net_weight:null}),'medium');
});

test('temperatures printed in Celsius are stored in Fahrenheit, and dates print with the year',()=>{
  const c=tickets();
  assert.equal(c.ticketFahrenheit(150,'C'),302);
  assert.equal(c.ticketFahrenheit(300,'F'),300);
  assert.equal(c.ticketDateText(new Date(Date.UTC(2026,8,1))),'2026-09-01');
  assert.equal(c.ticketDateText('9/1/2026'),'2026-09-01');
});

test('unconfirmed AI sizes never drive a quantity, and an assumed depth is labeled',()=>{
  const ctx=vm.createContext({});vm.runInContext(slice('function fixQuantity(','if (fix === \'Mill and Overlay\')')+'return null;}',ctx);
  const unconfirmed=ctx.fixQuantity('Saw-Cut Patch',{dim_area_sqft:10,dim_confirmed:false});
  assert.equal(unconfirmed.value,null);assert.match(unconfirmed.text,/confirm the measurement/);
  const assumed=ctx.fixQuantity('Saw-Cut Patch',{dim_area_sqft:10,dim_confirmed:true});
  assert.equal(assumed.depthAssumed,true);assert.match(assumed.text,/DEPTH NOT MEASURED/);
  assert.equal(ctx.fixQuantity('Saw-Cut Patch',{dim_area_sqft:10,dim_depth_in:3,dim_confirmed:true}).depthAssumed,false);
});

test('readiness: a Completed Work photo counts, words like "incomplete" do not, and tickets need tons',()=>{
  const ctx=vm.createContext({});
  vm.runInContext(slice('function evidenceChecklist(','function concreteEvidenceChecklist'),ctx);
  vm.runInContext(slice('function pavingEvidenceChecklist(','app.get(\'/api/paving/jobs/:id/completeness\''),ctx);
  const item=(r,key)=>r.checks.find(c=>c.key===key).complete;
  const base={note:'n',address:'a'};
  assert.equal(item(ctx.pavingEvidenceChecklist([{...base,note:'incomplete, finish in the afternoon'}],[],[]),'completion'),false);
  assert.equal(item(ctx.pavingEvidenceChecklist([{...base,paving_photo_reason:'completed_work'}],[],[]),'completion'),true);
  assert.equal(item(ctx.pavingEvidenceChecklist([base],[{net_tons:20},{net_tons:null}],[]),'tickets'),false);
  assert.equal(item(ctx.pavingEvidenceChecklist([base],[{net_tons:20}],[]),'tickets'),true);
});

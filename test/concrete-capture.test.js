const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const ConcreteCapture=require('../public/concrete-capture');
const app=fs.readFileSync('public/app.js','utf8');
test('photo purposes cover proposals, construction, completion, and later visits',()=>{
  assert.deepEqual(ConcreteCapture.phases.map(p=>p.id),['proposal','work','completion','follow_up']);
  assert.equal(ConcreteCapture.elements.patio,'Patio');
  for(const [phase,purposes] of Object.entries({proposal:['proposed_area','layout_dimensions','access','drainage','customer_request'],work:['reinforcement','placement','scope_change','work_problem'],completion:['finished_overview','handoff'],follow_up:['reported_problem','routine_review','repair_check']}))for(const purpose of purposes)assert.ok(ConcreteCapture.purpose(phase,purpose));
});
test('phase validation rejects mismatched purposes and preserves legacy stage meaning',()=>{
  assert.deepEqual(ConcreteCapture.normalize({concrete_phase:'proposal',concrete_purpose:'reinforcement'}),{concrete_phase:'proposal',concrete_purpose:null,concrete_stage:null});
  assert.equal(ConcreteCapture.normalize({concrete_phase:'proposal',concrete_purpose:'existing_condition'}).concrete_stage,'existing_condition');
  assert.equal(ConcreteCapture.normalize({concrete_phase:'work',concrete_purpose:'work_problem'}).concrete_stage,'defect');
  assert.equal(ConcreteCapture.normalize({concrete_phase:'follow_up',concrete_purpose:'reported_problem'}).concrete_stage,'defect');
  assert.equal(ConcreteCapture.normalize({concrete_phase:'fake',concrete_purpose:'repair'}).concrete_phase,null);
});
test('queued uploads retain every Concrete field and the project link',()=>{
  const context={FormData};vm.createContext(context);
  const fn=app.split('\n').find(line=>line.startsWith('function payloadFormData('));vm.runInContext(fn,context);
  const values={concrete_phase:'proposal',concrete_purpose:'proposed_area',concrete_element:'patio',concrete_stage:'existing_condition',concrete_condition:'not_assessed',concrete_severity:'none',concrete_location:'Backyard',concrete_mix:'Confirmed mix',job_id:'7'};
  const result=context.payloadFormData(values);for(const [key,value] of Object.entries(values))assert.equal(result.get(key),value);
});
test('changing phase clears an incompatible purpose without resetting photo or notes',()=>{
  const elements={},state={photoFile:{name:'site.png'},_note:'Customer wants a patio',_concreteCapture:{phase:'work',purpose:'work_problem',condition:'repair_needed',severity:'severe',location:'Backyard'}};
  const element=id=>elements[id]||(elements[id]={value:'',hidden:false,addEventListener(){}});
  const context={state,ConcreteCapture,esc:x=>String(x),document:{getElementById:element,querySelector:()=>element('details')}};vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('function concreteCaptureDraft()'),app.indexOf('function renderCapture()')),context);
  context.bindConcreteCapture();element('concretePhase').onchange({target:{value:'proposal'}});
  assert.equal(state._concreteCapture.purpose,'');assert.equal(state._concreteCapture.severity,'none');
  assert.equal(element('concreteConditionFields').hidden,true);assert.equal(element('concreteMixField').hidden,true);
  assert.equal(state.photoFile.name,'site.png');assert.equal(state._note,'Customer wants a patio');
  element('concretePurpose').onchange({target:{value:'proposed_area'}});
  assert.match(element('concretePhotoGuide').textContent,/whole area/);
  assert.equal(context.concreteCapturePayload().concrete_phase,'proposal');
  assert.equal(context.concreteCapturePayload().concrete_purpose,'proposed_area');
  assert.equal(context.concreteCapturePayload().concrete_severity,'none');
});

const {test}=require('node:test');const assert=require('node:assert/strict');
const cf=require('../custom-fields');
const base={name:'Store Number',type:'text',scope:'general',prompt:'',required:false,active:true,options:[]};
test('controlled definitions and edition gates',()=>{
 assert.equal(cf.definition(base).name,'Store Number');assert.equal(cf.normalizeEdition('general'),'pro');
 assert.equal(cf.EDITIONS.length,7);for(const e of ['basic','issue','roads'])assert.ok(!cf.EDITIONS.includes(e));
 for(const patch of [{name:''},{name:'x'.repeat(61)},{type:'photo'},{scope:'job'},{prompt:'x'.repeat(301)},{type:'choice',options:[]},{type:'choice',options:['A','A']}])assert.throws(()=>cf.definition({...base,...patch}));
});
test('five types preserve false and zero and reject invalid data',()=>{
 assert.equal(cf.value({...base,type:'number'},0),0);assert.equal(cf.value({...base,type:'boolean'},false),false);
 assert.equal(cf.value({...base,type:'date'},'2026-10-03'),'2026-10-03');
 for(const date of ['2026-02-30','10/03/2026'])assert.throws(()=>cf.value({...base,type:'date'},date));
 assert.throws(()=>cf.value({...base,type:'number'},Infinity));assert.throws(()=>cf.value(base,'a'.repeat(251)));
 assert.throws(()=>cf.value({...base,type:'choice',options:['A']},'B'));
});
const id='8adac415-49a2-4b13-a548-2e2aa4d15d97';
const db=defs=>({query:async()=>({rows:defs})});
test('offline revisions survive rename, deactivation and removed choices',async()=>{
 const old={...base,name:'Roof Section',type:'choice',options:['A','B']};const d={...old,id,user_id:1,name:'New Name',options:['C'],active:false,revision:2,versions:{1:old}};
 const saved=await cf.captureValues(db([d]),1,'pro',[{id,revision:1,value:'B'}]);
 assert.equal(saved[0].name,'Roof Section');assert.equal(saved[0].value,'B');
 const retained=await cf.captureValues(db([d]),1,'pro',[{id,value:'B'}],{previous:saved,editing:true});assert.deepEqual(retained,saved);
 await assert.rejects(cf.captureValues(db([d]),1,'pro',[{id,value:'C'}],{previous:saved,editing:true}));
 assert.match(cf.lines({custom_fields:saved}),/Roof Section: B/);
});
test('owner and scope validation and required fields',async()=>{
 const d={...base,id,required:true,revision:1,versions:{1:{...base,required:true}}};
 assert.deepEqual(await cf.captureValues(db([d]),1,'pro',[]),[]); // New definitions cannot invalidate an older offline draft.
 await assert.rejects(cf.captureValues(db([d]),1,'pro',[{id,revision:1,value:''}]),/required/);
 await assert.rejects(cf.captureValues(db([]),2,'pro',[{id,revision:1,value:'1842'}]),/unavailable/);
 await assert.rejects(cf.captureValues(db([{...d,scope:'edition',edition:'concrete'}]),1,'pro',[{id,revision:1,value:'1842'}]),/unavailable/);
});
test('unchanged historical option remains and clearing optional value is explicit',async()=>{
 const previous=[{id,name:'Surface',type:'choice',value:'Gravel',revision:1}],d={...base,id,type:'choice',options:['Asphalt'],revision:2};
 assert.deepEqual(await cf.captureValues(db([d]),1,'pro',[{id,value:'Gravel'}],{previous,editing:true}),previous);
 assert.deepEqual(await cf.captureValues(db([d]),1,'pro',[{id,value:null}],{previous,editing:true}),[]);
});

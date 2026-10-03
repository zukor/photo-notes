const {test}=require('node:test');
const assert=require('node:assert/strict');
const {eligible,validateRequest,validateSubmission}=require('../photo-requests');
const {privatePhotoToken}=require('../external-photo-submission');
test('only requested Pro editions can use Photo Requests',()=>{
 for(const pro_type of ['general','hoa','property','paving','concrete','contractor','roofer'])assert.equal(eligible({plan:'pro',pro_type}),true);
 for(const pro_type of ['general','issue','roads'])assert.equal(eligible({plan:'free',pro_type}),false);
 assert.equal(eligible({plan:'pro',pro_type:'issue'}),false);assert.equal(eligible({plan:'pro',pro_type:'roads'}),false);
});
test('custom views, default expiry and explicit partial setting',()=>{
 const r=validateRequest({title:'Unit 4',instructions:'Photograph unit',views:['My custom view','Equipment plate']});
 assert.equal(r.days,14);assert.equal(r.allow_partial,false);assert.deepEqual(r.views,['My custom view','Equipment plate']);
 assert.equal(validateRequest({...r,allow_partial:true}).allow_partial,true);
 for(const bad of [{views:[]},{views:['a','A']},{views:Array(9).fill('a')},{days:0},{days:31},{title:''},{instructions:''}])assert.throws(()=>validateRequest({...r,...bad}));
});
test('required views cannot complete or submit early; partial submissions remain open',()=>{
 const r={views:['Overall','Plate','Damage'],allow_partial:false};
 assert.throws(()=>validateSubmission(r,[],[0,1]));assert.equal(validateSubmission(r,[],[0,1,2]),'completed');
 r.allow_partial=true;assert.equal(validateSubmission(r,[],[0]),'partially_submitted');assert.equal(validateSubmission(r,[{view_index:0}],[1,2]),'completed');
 for(const indices of [[],[0],[3],[-1],['1'],[1,1]])assert.throws(()=>validateSubmission(r,[{view_index:0}],indices));
});
test('private links use 192 bits of cryptographic randomness',()=>{const tokens=new Set(Array.from({length:100},privatePhotoToken));assert.equal(tokens.size,100);for(const token of tokens)assert.match(token,/^[A-Za-z0-9_-]{32}$/);});

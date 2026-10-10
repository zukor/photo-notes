const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/send.js','utf8');
function fixture(save){const buttons={send:{},save:{}},events=[];const c={window:{},q:id=>buttons[id],state:{photoFile:{name:'actual.jpg'}},lastFile:{name:'stale.jpg'},caption:()=> 'caption',noteVal:()=> 'note',saveCapture:save,locale:()=> 'en',share:async(file,text)=>{events.push({file,text});return false;},toast:m=>events.push(m)};c.persistCaptureDraft=async()=>{};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('  var sending'),source.indexOf('  function injectButtons')),c);c.showSavedShare=(file,text)=>events.push({file,text});return {c,events,buttons};}
test('capture sharing waits for durable save, suppresses double taps, and uses current photo',async()=>{let finish,calls=0;const f=fixture(async options=>{calls++;assert.equal(options.requireDurable,true);assert.equal(options.preserveDraft,true);return await new Promise(r=>finish=r);});const pending=f.c.onSend();await f.c.onSend();assert.equal(calls,1);assert.equal(f.events.length,0);assert.equal(f.buttons.save.disabled,true);finish(true);await pending;assert.equal(f.events[0].file.name,'actual.jpg');assert.equal(f.buttons.save.disabled,false);});
test('failed or declined saving never opens sharing',async()=>{for(const save of [async()=>false,async()=>{throw Error('storage');}]){const f=fixture(save);await f.c.onSend();assert(!f.events.some(e=>e.file));assert.equal(f.buttons.send.disabled,false);}});

function saveFixture(){
  const photo={name:'wall.jpg'},note={value:'Raise the wall one foot'},state={photoFile:photo,_note:note.value,me:{email:'owner@example.invalid'},location:{lat:1,lng:2}};
  let saves=0,renders=0;
  const context={state,document:{getElementById:()=>note},finishCaptureDictation:async()=>{},stopCaptureDictation(){},toast(){},isSecurityClient:()=>false,isHoaClient:()=>false,isConcreteClient:()=>false,isPavingClient:()=>false,selectedEdition:()=> 'pro',confirmPhotoQuality:async()=>true,enqueueUpload:async()=>{saves++;},freshDims:()=>({}),renderCapture:()=>{renders++;note.value='';},captureLocationGeneration:0};
  context.persistCaptureDraft=async()=>{};vm.createContext(context);const app=fs.readFileSync('public/app.js','utf8');vm.runInContext(app.slice(app.indexOf('async function saveCaptureDurably('),app.indexOf('// ================= HOA Maintenance Pro')),context);
  return {context,state,note,photo,saves:()=>saves,renders:()=>renders};
}
test('cancel sharing then Save preserves the draft and creates only one durable capture',async()=>{
 const f=saveFixture();assert.equal(await f.context.saveCaptureDurably({preserveDraft:true}),true);
 assert.equal(f.state.photoFile,f.photo);assert.equal(f.note.value,'Raise the wall one foot');assert.equal(f.renders(),0);
 // A repeated share or a late background location update must not duplicate the save.
 f.state.address='Resolved address';await f.context.saveCaptureDurably({preserveDraft:true});assert.equal(f.saves(),1);
 await f.context.saveCaptureDurably({});assert.equal(f.saves(),1);assert.equal(f.state.photoFile,null);assert.equal(f.note.value,'');assert.equal(f.renders(),1);
});
test('changed notes are not silently skipped and storage failure retains the draft',async()=>{
 const f=saveFixture();await f.context.saveCaptureDurably({preserveDraft:true});f.note.value='Revised request';await f.context.saveCaptureDurably({});assert.equal(f.saves(),2);
 const failed=saveFixture();failed.context.enqueueUpload=async()=>{throw Error('disk unavailable');};assert.equal(await failed.context.saveCaptureDurably({preserveDraft:true}),false);assert.equal(failed.state.photoFile,failed.photo);assert.equal(failed.note.value,'Raise the wall one foot');assert.equal(failed.state._captureShareSave,undefined);
});


test('Basic invokes sharing synchronously on the tap without saving',async()=>{
 let saves=0;const f=fixture(async()=>{saves++;return true;});f.c.isBasicClient=()=>true;
 f.c.prepareBasicShare();const pending=f.c.onSend();
 assert.equal(f.events.length,1,'native share is invoked before the first async pause');
 await pending;assert.equal(saves,0);assert.equal(f.c.state.photoFile.name,'actual.jpg');
});
test('Basic waits for captioned photo preparation and invalidates changed notes',async()=>{
 const f=fixture(async()=>{throw Error('Basic must not save');});f.c.isBasicClient=()=>true;
 let finish;f.c.window.PhotoNotesShareImage={withDetails:()=>new Promise(r=>finish=r)};
 f.c.prepareBasicShare();assert.equal(f.buttons.send.disabled,true);await f.c.onSend();assert.equal(f.events.length,0);
 finish({name:'captioned.jpg'});await new Promise(r=>setImmediate(r));
 const pending=f.c.onSend();assert.equal(f.events[0].file.name,'captioned.jpg');await pending;
 f.c.noteVal=()=> 'changed';f.c.prepareBasicShare();assert.equal(f.buttons.send.disabled,true);
 finish({name:'revised.jpg'});await new Promise(r=>setImmediate(r));await f.c.onSend();assert.equal(f.events[1].file.name,'revised.jpg');
});


test('Issue Reporter shares the selected Topic and refreshes prepared shares after topic changes',async()=>{
 const f=fixture(async()=>{throw Error('Issue Reporter follows Basic sharing');});f.c.isBasicClient=()=>true;
 f.c.state.area='Broken gate';f.c.isIssueReporterClient=()=>true;f.c.tr=text=>text;f.c.shortState=text=>text;
 vm.runInContext(source.slice(source.indexOf('  function caption()'),source.indexOf('  function toast(')),f.c);
 await f.c.onSend();assert.match(f.events[0].text,/Topic: Broken gate/);
 f.c.state.area='Leaking pipe';await f.c.onSend();assert.match(f.events[1].text,/Topic: Leaking pipe/);assert.doesNotMatch(f.events[1].text,/Broken gate/);
 f.c.isIssueReporterClient=()=>false;assert.match(f.c.caption(),/Topic: Leaking pipe/);
});

test('device share reports success, cancellation, and failure separately',async()=>{
 for(const outcome of ['success','AbortError','NotAllowedError']){
  const events=[],context={navigator:{canShare:()=>true,share:async()=>{if(outcome!=='success')throw Object.assign(Error('share'),{name:outcome});}},tr:x=>x,toast:x=>events.push(x)};
  vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  async function share('),source.indexOf('  var sending')),context);
  assert.equal(await context.share({name:'photo.jpg'},'note'),outcome==='success');
  assert.equal(context.share.lastOutcome,outcome==='success'?'shared':outcome==='AbortError'?'canceled':'failed');
 }
});
test('completing a saved share clears photo and notes without another upload',async()=>{
 const f=saveFixture();await f.context.saveCaptureDurably({preserveDraft:true});f.context.clearCompletedCapture();
 assert.equal(f.state.photoFile,null);assert.equal(f.state._note,'');assert.equal(f.note.value,'');assert.equal(f.state._captureShareSave,null);assert.equal(f.saves(),1);
});

test('share confirmation retains the upload receipt across repeated Share taps',async()=>{
 const f=saveFixture();let receipt;
 f.context.enqueueUpload=async(payload,coords,options)=>{receipt=options.receipt;};
 await f.context.saveCaptureDurably({preserveDraft:true});
 assert.equal(receipt.captureShare,true);assert.equal(receipt.uploaded,false);
 receipt.uploaded=true;await f.context.saveCaptureDurably({preserveDraft:true});
 assert.equal(f.state._captureShareSave.receipt,receipt);assert.equal(f.state._captureShareSave.receipt.uploaded,true);
});

test('Capture sharing includes GPS and address together plus PhotoNote metadata',()=>{
 const nodes={gps:{textContent:'29.55655, -98.55486'},addr:{textContent:'47 Villa Jardin, San Antonio, TX 78230'}};
 const field={id:'captureUrgency',tagName:'SELECT',type:'select-one',value:'standard',selectedOptions:[{textContent:'Standard'}],labels:[{textContent:'Urgency'}]};
 const c={state:{location:{lat:29.55655,lng:-98.55486},address:nodes.addr.textContent,area:'Pool drainage'},q:id=>nodes[id],noteVal:()=> 'Somebody is emptying their pool.',tr:x=>x,locale:()=> 'en-US',document:{querySelectorAll:()=>[field]}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('  function caption()'),source.indexOf('  function toast')),c);
 const text=c.caption();assert.match(text,/GPS Coordinates: 29.55655, -98.55486/);assert.match(text,/Address: 47 Villa Jardin/);assert.match(text,/Notes: Somebody/);assert.match(text,/Topic: Pool drainage/);assert.match(text,/Urgency: Standard/);
 c.state.location={lat:0,lng:0};assert.match(c.caption(),/GPS Coordinates: 0, 0/);
 c.state.location=null;nodes.gps.textContent='Getting location...';assert.doesNotMatch(c.caption(),/GPS Coordinates:/);
});

test('Security Issue Type is included in shared details and changes the prepared-share identity',()=>{
 const field={id:'securityIssueType',tagName:'SELECT',type:'select-one',value:'Security Issue',selectedOptions:[{textContent:'Security Issue'}],labels:[{textContent:'Issue Type'}]};
 const c={state:{securityIssueType:'Security Issue',proType:'security'},q:()=>null,noteVal:()=> 'Observed condition',tr:x=>x,locale:()=> 'en-US',document:{querySelectorAll:()=>[field]}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('  function caption()'),source.indexOf('  function toast')),c);
 vm.runInContext(source.match(/  function shareKey\(\)[^\n]+/)[0],c);
 const before=c.shareKey();assert.match(c.caption(),/Issue Type: Security Issue/);
 c.state.securityIssueType='Emergency';field.value='Emergency';field.selectedOptions=[{textContent:'Emergency'}];
 assert.notEqual(c.shareKey(),before);assert.match(c.caption(),/Issue Type: Emergency/);
});

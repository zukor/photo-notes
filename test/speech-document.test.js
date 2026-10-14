const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function harness(){const frames=[],timers=new Map();let seq=0;const window={addEventListener(){}};const document={body:{append(frame){frames.push(frame);}},createElement(){return {contentWindow:{SpeechRecognition:class{}},remove(){this.removed=true;}};}};vm.runInNewContext(fs.readFileSync('public/speech-document.js','utf8'),{window,document,setTimeout(fn){timers.set(++seq,fn);return seq;},clearTimeout(id){timers.delete(id);}});return {api:window.PhotoNotesSpeechDocument,frames,timers};}
test('fresh speech documents preload, replace on reset, and ignore stale readiness',()=>{const h=harness(),states=[];h.api.prepare(s=>states.push(s));assert.equal(h.api.constructor(),null);const first=h.frames[0];first.onload();const old=h.api.constructor();assert(old);h.api.reset();assert(first.removed);first.onload();assert.equal(h.api.constructor(),null);h.frames[1].onload();assert(h.api.constructor());assert.notEqual(h.api.constructor(),old);assert.equal(h.frames[1].src,'/speech-session-frame.html');assert.equal(h.frames[1].allow,'microphone');h.api.dispose();assert.equal(h.api.constructor(),null);assert.equal(h.timers.size,0);});
test('blocked or unavailable speech documents report failure without parent fallback',()=>{for(const mode of ['error','unsupported','timeout']){const h=harness(),states=[];h.api.prepare(s=>states.push(s));const frame=h.frames[0];if(mode==='error')frame.onerror();if(mode==='unsupported'){frame.contentWindow={};frame.onload();}if(mode==='timeout')[...h.timers.values()][0]();assert.equal(states.at(-1).failed,true);assert.equal(h.api.constructor(),null);h.api.dispose();}});

test('Feedback and Capture speech contexts dispose independently',()=>{const h=harness();const feedback=h.api.create();h.api.prepare(()=>{});feedback.prepare(()=>{});h.frames[0].onload();h.frames[1].onload();const capture=h.api.constructor();feedback.dispose();assert.equal(h.api.constructor(),capture);assert(!h.frames[0].removed);assert(h.frames[1].removed);feedback.prepare(()=>{});h.frames[2].onload();assert(feedback.constructor());assert.equal(h.api.constructor(),capture);feedback.dispose();h.api.dispose();assert.equal(h.timers.size,0);});

function microphoneHarness(getUserMedia){
 const window={addEventListener(){}},delays=[];
 vm.runInNewContext(fs.readFileSync('public/speech-document.js','utf8'),{window,navigator:{mediaDevices:{getUserMedia}},document:{},setTimeout(fn,ms){if(ms===300)delays.push(ms);return setTimeout(fn,ms===300?0:ms);},clearTimeout});
 return {prime:window.PhotoNotesSpeechDocument.primeMicrophone,delays};
}
test('shared microphone reset releases every track before speech may start and can repeat across features',async()=>{
 let stops=0,calls=0;const h=microphoneHarness(async()=>{calls++;return {getTracks:()=>[{stop(){stops++;}},{stop(){stops++;}}]};});
 for(let cycle=1;cycle<=4;cycle++){assert.equal(await h.prime(),true);assert.equal(stops,cycle*2);}
 assert.equal(calls,4);assert.deepEqual(h.delays,[300,300,300,300]);
});
test('cancel during microphone permission releases late tracks and never starts speech',async()=>{
 let resolve,stopped=false,current=true;const h=microphoneHarness(()=>new Promise(done=>resolve=done));
 const pending=h.prime(()=>current);await Promise.resolve();current=false;resolve({getTracks:()=>[{stop(){stopped=true;}}]});
 assert.equal(await pending,false);assert(stopped);assert.equal(h.delays.length,0);
});
test('microphone reset serializes both features and recovers after permission denial',async()=>{
 let reject;const h=microphoneHarness(()=>new Promise((_,fail)=>reject=fail));
 const pending=h.prime();await assert.rejects(h.prime(),/already in progress/);reject(new Error('denied'));await assert.rejects(pending,/denied/);
 const retry=h.prime();await Promise.resolve();reject(new Error('denied again'));await assert.rejects(retry,/denied again/);
});
test('permission timeout releases a late microphone stream without starting recognition',async()=>{
 let resolve,stops=0;const timers=new Map(),window={addEventListener(){}};
 vm.runInNewContext(fs.readFileSync('public/speech-document.js','utf8'),{window,navigator:{mediaDevices:{getUserMedia:()=>new Promise(done=>resolve=done)}},setTimeout(fn,ms){timers.set(ms,fn);return ms;},clearTimeout(id){timers.delete(id);}});
 const pending=window.PhotoNotesSpeechDocument.primeMicrophone();await Promise.resolve();timers.get(15000)();
 await assert.rejects(pending,/timed out/);resolve({getTracks:()=>[{stop(){stops++;}}]});await Promise.resolve();await Promise.resolve();assert.equal(stops,1);
});

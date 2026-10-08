const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('public/app.js','utf8');
function harness(ios=true){
 const timers=new Map(),sessions=[],elements={note:{value:'Existing note'},dictate:{textContent:'Record Notes',disabled:false,classList:{add(){},remove(){}}},dictationStatus:{textContent:''}};let next=0;
 class Speech{constructor(){sessions.push(this);}start(){this.started=true;}stop(){this.stopped=true;}}
 const ctx=vm.createContext({persistCaptureDraft:async()=>{},window:{SpeechRecognition:Speech},navigator:{userAgent:ios?'iPhone':'Android',mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}},document:{getElementById:id=>elements[id]},state:{photoFile:{name:'photo'}},uiSpeechLanguage:()=> 'en-US',toast(){},isIndustryProClient:()=>false,combineSpeechResults:parts=>parts.join(' '),mergeSpeechTranscript:(a,b)=>(a.trim()+' '+b.trim()).trim(),setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext('let iosDictationSession=null,iosDictationConstructor=null,recognizer=null,dictationActive=false,dictationRestartTimer=null,dictationWatchdog=null,dictationGeneration=0,dictationBase="",dictationFinish=null;'+source.slice(source.indexOf('let dictationEmptySessions'),source.indexOf('let currentGroupItems'))+source.slice(source.indexOf('function cleanupDictation()'),source.indexOf('// ================= Pro dimension fields')),ctx);
 return {run:code=>vm.runInContext(code,ctx),sessions,elements,timers,result(text){sessions.at(-1).onresult({results:[[{transcript:text}]]});}};
}
test('iPhone Stop accepts delayed final words before ending, then can record again',async()=>{
 const h=harness();await h.run('toggleDictation()');const s=h.sessions[0];const done=h.run('toggleDictation()');assert(s.stopped);assert.equal(h.elements.dictate.disabled,true);h.result('final iPhone words');s.onend();await done;
 assert.equal(h.elements.note.value,'Existing note final iPhone words');assert.equal(h.elements.dictate.disabled,false);assert.equal(h.timers.size,0);await h.run('toggleDictation()');assert.equal(h.sessions.length,1);
});
test('Save waits for the same delayed final result',async()=>{
 const h=harness();await h.run('toggleDictation()');let done=false;const finish=h.run('finishCaptureDictation()').then(()=>done=true);await Promise.resolve();assert.equal(done,false);h.result('saved final words');h.sessions[0].onend();await finish;assert.equal(h.elements.note.value,'Existing note saved final words');
});
test('iPhone permission and long speech do not hit the old ten second timeout',async()=>{
 const h=harness();await h.run('toggleDictation()');assert.equal([...h.timers.values()][0].ms,30000);h.sessions[0].onaudiostart();assert.equal([...h.timers.values()][0].ms,30000);h.sessions[0].onspeechstart();assert.equal([...h.timers.values()][0].ms,120000);h.result('a long phrase');h.sessions[0].onend();assert.equal(h.timers.size,0,'iPhone waits for a user tap instead of restarting without a gesture');
});
test('changing photo cancels old words and stale errors',async()=>{
 const h=harness();await h.run('toggleDictation()');await h.run('stopCaptureDictation();state.photoFile={name:"next photo"}');await h.run('toggleDictation()');h.sessions[0].onresult({results:[[{transcript:'OLD WORDS'}]]});h.sessions[0].onerror({error:'not-allowed'});assert.equal(h.elements.note.value,'Existing note');assert.equal(h.run('dictationActive'),true);
});
test('Android still restarts after a pause and Stop prevents a restart',async()=>{
 const h=harness(false);await h.run('toggleDictation()');h.result('Android words');h.sessions[0].onend();const restart=[...h.timers.values()].find(t=>t.ms===300);assert(restart);restart.fn();const done=h.run('finishCaptureDictation()');h.sessions[1].onend();await done;assert.equal(h.run('dictationActive'),false);
});
test('unresponsive speech service releases the Stop button after a bounded wait',async()=>{
 const h=harness();await h.run('toggleDictation()');const done=h.run('finishCaptureDictation()');[...h.timers.values()].find(t=>t.ms===8000).fn();await done;assert.equal(h.elements.dictate.disabled,false);assert.equal(h.run('recognizer'),null);
});


test('unavailable speech constructors and failed startup show an actionable fallback',async()=>{
 for(const constructorFails of [true,false]){
  const h=harness();h.run(constructorFails?'window.SpeechRecognition=class{constructor(){throw Error("unavailable")}}':'window.SpeechRecognition=class{start(){throw Error("unavailable")}}');
  await h.run('toggleDictation()');assert.equal(h.run('dictationActive'),false);assert.equal(h.elements.dictate.disabled,false);assert.match(h.elements.dictationStatus.textContent,/keyboard microphone/);assert.equal(h.elements.note.value,'Existing note');assert.equal(h.timers.size,0);
 }
});


test('terminal speech errors release controls even when Safari never emits onend',async()=>{
 for(const error of ['not-allowed','service-not-allowed','network','audio-capture']){
  const h=harness();await h.run('toggleDictation()');h.sessions[0].onerror({error});
  assert.equal(h.run('dictationActive'),false);assert.equal(h.elements.dictate.textContent,'Record Notes');assert.equal(h.timers.size,0);assert.equal(h.elements.note.value,'Existing note');
  await h.run('toggleDictation()');assert.equal(h.sessions.length,2);h.sessions[0].onend();assert.equal(h.run('dictationActive'),true);
 }
});

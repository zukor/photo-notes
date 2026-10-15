const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('public/app.js','utf8');
function harness({ios=true,pending=false,exclusive=false,retainOnEnd=false,abortEvents=false,realResults=false}={}){
 const elements={},sessions=[],timers=new Map(),logs={},interruptions=[];let next=0,permission,tracksStopped=0,owner,now=1000000;
 class ClockDate extends Date{static now(){return now;}}
 class Speech{constructor(){sessions.push(this);}start(){if(exclusive&&owner&&owner!==this)throw new Error('Microphone still owned');owner=this;}stop(){this.stopped=true;}abort(){this.aborted=true;if(owner===this)owner=null;if(abortEvents){this.onerror?.({error:"aborted"});this.onend?.();}}set onend(handler){this.end=()=>{if(owner===this&&!retainOnEnd)owner=null;handler();};}get onend(){return this.end;}}
 const stream={getTracks:()=>[{stop:()=>tracksStopped++}]};
 const context=vm.createContext({Date:ClockDate,Promise,JSON,navigator:{userAgent:ios?'iPhone':'Android',onLine:true,mediaDevices:{getUserMedia:()=>pending?new Promise(r=>permission=r):Promise.resolve(stream)}},window:{SpeechRecognition:Speech},document:{visibilityState:'visible',getElementById:id=>elements[id]||=( {value:'',textContent:'',remove(){},focus(){},classList:{add(){},remove(){}}})},localStorage:{getItem:k=>logs[k],setItem:(k,v)=>logs[k]=v},state:{photoFile:{}},uiSpeechLanguage:()=> 'en-US',isIndustryProClient:()=>false,showDictationInterruption:reason=>interruptions.push(reason),toast(){},persistCaptureDraft:async()=>{},setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimeout:id=>timers.delete(id)});
 if(realResults){const shared=fs.readFileSync('public/issue-reporter.js','utf8');vm.runInContext(shared.slice(shared.indexOf('function cleanSpeechTranscript'),shared.indexOf('async function toggleIssueDictation')),context);}
 vm.runInContext("let iosDictationSession=null,iosDictationConstructor=null,recognizer=null,dictationActive=false,dictationRestartTimer=null,dictationWatchdog=null,dictationGeneration=0,dictationBase='',dictationFinish=null;"+source.slice(source.indexOf('let dictationEmptySessions'),source.indexOf('let currentGroupItems'))+(realResults?"":"function combineSpeechResults(parts){return parts.join(' ');}function mergeSpeechTranscript(a,b){return (a.trim()+' '+b.trim()).trim();}function mergeSpeechContinuation(a,b){return mergeSpeechTranscript(a,b);}")+source.slice(source.indexOf('function cleanupDictation()'),source.indexOf('// ================= Pro dimension fields')),context);
 return {run:c=>vm.runInContext(c,context),sessions,elements,timers,logs,interruptions,advance:ms=>now+=ms,resolve:()=>permission(stream),tracksStopped:()=>tracksStopped,fire:ms=>{for(const [id,t]of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}}};
}
test('Android quiet endings after received words allow a 45-second pause in one recording',async()=>{
 const h=harness({ios:false,realResults:true});await h.run('toggleDictation()');
 h.sessions[0].onresult({results:[[{transcript:'First observation'}]]});
 for(const elapsed of [10000,15000,20000]){
  h.advance(elapsed);const current=h.sessions.at(-1);current.onerror({error:'no-speech'});
  assert.equal(h.interruptions.length,0,'silence after words does not interrupt');
  current.onend();h.fire(250);assert.equal(h.run('dictationActive'),true);
 }
 h.sessions.at(-1).onresult({results:[[{transcript:'Second observation after the pause'}]]});
 assert.equal(h.elements.note.value,'First observation Second observation after the pause');
 const finish=h.run('finishCaptureDictation()');h.sessions.at(-1).onend();await finish;
 assert.equal(h.run('dictationActive'),false);assert.equal(h.timers.size,0);
});
test('Android empty continuations share one minute from the last words, not a new timeout per session',async()=>{
 const h=harness({ios:false});await h.run('toggleDictation()');h.sessions[0].onresult({results:[[{transcript:'Kept observation'}]]});
 h.advance(10000);h.sessions[0].onend();h.fire(250);
 assert([...h.timers.values()].some(t=>t.ms===50000));
 h.advance(30000);h.sessions.at(-1).onerror({error:'no-speech'});h.sessions.at(-1).onend();h.fire(250);
 assert([...h.timers.values()].some(t=>t.ms===20000));
 h.advance(20000);h.fire(20000);
 assert.equal(h.run('dictationActive'),false);assert.equal(h.interruptions.length,1);
 assert.equal(h.elements.note.value,'Kept observation');assert.equal(h.timers.size,0);
});
test('Android no-speech without end still stops at the quiet deadline and a manual recording starts fresh',async()=>{
 const h=harness({ios:false});await h.run('toggleDictation()');h.sessions[0].onresult({results:[[{transcript:'Kept observation'}]]});
 h.advance(10000);h.sessions[0].onerror({error:'no-speech'});
 assert.equal(h.run('dictationActive'),true);assert.equal(h.interruptions.length,0);
 h.advance(50000);h.fire(50000);
 assert.equal(h.run('dictationActive'),false);assert.ok(h.sessions[0].aborted);assert.equal(h.interruptions.length,1);
 await h.run('toggleDictation()');h.fire(30000);
 assert.equal(h.run('dictationActive'),false);assert.equal(h.interruptions.length,2);assert.equal(h.elements.note.value,'Kept observation');
});
test('Stop and navigation cancel a quiet Android continuation before it can restart',async()=>{
 for(const action of ['finishCaptureDictation()','stopCaptureDictation()']){
  const h=harness({ios:false});await h.run('toggleDictation()');h.sessions[0].onresult({results:[[{transcript:'Kept observation'}]]});
  h.sessions[0].onerror({error:'no-speech'});h.sessions[0].onend();
  await h.run(action);h.fire(250);h.sessions[0].onend();
  assert.equal(h.sessions.length,1);assert.equal(h.run('dictationActive'),false);
  assert.equal(h.elements.note.value,'Kept observation');assert.equal(h.timers.size,0);
 }
});
test('network and hidden-client interruptions are not treated as an Android speech pause',async()=>{
 for(const hidden of [false,true]){
  const h=harness({ios:false});await h.run('toggleDictation()');h.sessions[0].onresult({results:[[{transcript:'Kept observation'}]]});
  if(hidden)h.run("document.visibilityState='hidden'");h.sessions[0].onerror({error:hidden?'no-speech':'network'});h.sessions[0].onend();h.fire(250);
  assert.equal(h.run('dictationActive'),false);assert.equal(h.sessions.length,1);assert.equal(h.interruptions.length,1);
 }
});
test('Stop keeps Safari final results until end, and finishing blocks another start',async()=>{
 const h=harness();await h.run('toggleDictation()');const s=h.sessions[0];const stopping=h.run('toggleDictation()');await h.run('toggleDictation()');assert.equal(h.sessions.length,1);
 s.onresult({results:[[{transcript:'Final words'}]]});s.onend();await stopping;
 assert.equal(h.elements.note.value,'Final words');assert.equal(h.elements.dictate.textContent,'Record Notes');assert.equal(h.timers.size,0);
});
test('silent browser without end callback resets and permits retry',async()=>{
 const h=harness();await h.run('toggleDictation()');h.fire(30000);assert.equal(h.run('dictationActive'),false);assert.equal(h.elements.dictate.textContent,'Record Notes');assert.ok(h.sessions[0].aborted);await h.run('toggleDictation()');assert.equal(h.sessions.length,2);
});
test('Stop missing end callback finishes within eight seconds',async()=>{
 const h=harness({exclusive:true});await h.run('toggleDictation()');const finish=h.run('finishCaptureDictation()');h.fire(8000);await finish;assert.equal(h.elements.dictate.textContent,'Record Notes');assert.ok(h.sessions[0].aborted);
 await h.run('toggleDictation()');assert.equal(h.run('dictationActive'),true);h.sessions[1].onresult({results:[[{transcript:'Second recording'}]]});assert.equal(h.elements.note.value,'Second recording');
});
test('forty iPhone recordings preserve successive notes and release microphone ownership',async()=>{
 const h=harness({exclusive:true});
 for(let i=0;i<40;i++){
  await h.run('toggleDictation()');assert.equal(h.run('dictationActive'),true);
  const s=h.sessions.at(-1);const finishing=h.run('toggleDictation()');
  s.onresult({results:[[{transcript:`Phrase${i}`}]]});s.onend();await finishing;
  s.onresult({results:[[{transcript:'STALE WORDS'}]]});s.onend();s.onerror({error:'network'});
 }
 assert.equal(h.elements.note.value.replace(/\s+/g,' '),Array.from({length:40},(_,i)=>`Phrase${i}`).join(' '));assert.equal(h.timers.size,0);
});
test('late start callback cannot overwrite finishing status',async()=>{
 const h=harness();await h.run('toggleDictation()');const finishing=h.run('toggleDictation()');
 const status=h.elements.dictationStatus.textContent;h.sessions[0].onstart();assert.equal(h.elements.dictationStatus.textContent,status);assert.equal(h.elements.dictate.textContent,'Finishing Notes...');h.sessions[0].onend();await finishing;
});
test('long speech and pauses keep listening until an explicit Stop',async()=>{
 const h=harness();await h.run('toggleDictation()');h.sessions[0].onstart();h.sessions[0].onresult({results:[[{transcript:'Long speech',isFinal:false}]]});
 h.fire(30000);h.fire(120000);assert.equal(h.run('dictationActive'),true);assert.equal(h.interruptions.length,0);assert.equal(h.elements.note.value,'Long speech');
});
test('cancel pending microphone permission discards eventual stream',async()=>{
 const h=harness({ios:false,pending:true});const starting=h.run('toggleDictation()');await h.run('toggleDictation()');h.resolve();await starting;assert.equal(h.sessions.length,0);assert.equal(h.tracksStopped(),1);
});
test('stale error cannot stop a newer recording',async()=>{
 const h=harness();await h.run('toggleDictation()');const old=h.sessions[0];h.run('stopCaptureDictation()');await h.run('toggleDictation()');old.onerror({error:'network'});assert.equal(h.run('dictationActive'),true);
});
test('unexpected iPhone browser end keeps words and requests a user restart',async()=>{
 for(const ios of [true]){const h=harness({ios});await h.run('toggleDictation()');h.sessions[0].onresult({results:[[{transcript:'Kept words'}]]});h.sessions[0].onend();h.fire(300);assert.equal(h.sessions.length,1);assert.equal(h.interruptions.length,1);assert.equal(h.elements.note.value,'Kept words');await h.run('toggleDictation()');h.sessions[1].onresult({results:[[{transcript:'New words'}]]});assert.equal(h.elements.note.value,'Kept words New words');}
});
test('fatal error resets without an end event; diagnostic log excludes words',async()=>{
 const h=harness();await h.run('toggleDictation()');h.sessions[0].onresult({results:[[{transcript:'Private note text'}]]});h.sessions[0].onerror({error:'network'});assert.equal(h.elements.dictate.textContent,'Record Notes');assert.equal(h.elements.note.value,'Private note text');assert.ok(!h.logs.photoNotesSpeechDiagnostics.includes('Private note text'));
});
test('Save awaits completion before reading the note',()=>{assert.match(source,/async function saveCaptureDurably\(options = \{\}\) \{\s+await finishCaptureDictation\(\);\s+stopCaptureDictation\(\);\s+const note/);});

test('a delayed result without end does not cancel the finishing deadline',async()=>{
 const h=harness();await h.run('toggleDictation()');const finish=h.run('finishCaptureDictation()');h.sessions[0].onresult({results:[[{transcript:'Kept words'}]]});h.fire(8000);await finish;assert.equal(h.elements.note.value,'Kept words');assert.equal(h.elements.dictate.textContent,'Record Notes');
});

test('Android unexpected error opens one interruption and does not loop',async()=>{
 for(const error of ['no-speech','aborted']){const h=harness({ios:false});await h.run('toggleDictation()');h.sessions[0].onerror({error});h.sessions[0].onend();h.fire(300);assert.equal(h.sessions.length,1);assert.equal(h.interruptions.length,1);assert.equal(h.run('dictationActive'),false);}
});
test('Safari completed recognizer is released on the next user tap, after final results',async()=>{
 const h=harness({exclusive:true,abortEvents:true});
 for(let i=0;i<10;i++){await h.run('toggleDictation()');const s=h.sessions.at(-1);assert.equal(h.run('dictationActive'),true);s.onresult({results:[[{transcript:'Recording '+i}]]});const stopping=h.run('toggleDictation()');s.onend();await stopping;assert.notEqual(s.aborted,true);}
 assert.equal(h.sessions.length,10);for(const s of h.sessions.slice(0,-1))assert.notEqual(s.aborted,true);assert(h.elements.note.value.includes('Recording 9'));
});

test('audio start without transcription cannot leave Capture listening forever',async()=>{
 const h=harness();await h.run('toggleDictation()');const first=h.sessions[0];first.onstart();first.onaudiostart();first.onspeechstart();h.fire(30000);
 assert.equal(h.run('dictationActive'),false);assert.ok(first.aborted);assert.match(h.interruptions[0],/no words were received/);
 await h.run('toggleDictation()');h.sessions[1].onresult({results:[[{transcript:'Recovered words'}]]});h.fire(30000);assert.equal(h.run('dictationActive'),true);assert.equal(h.elements.note.value,'Recovered words');
});


test('one Android recording reconciles phone suffixes across automatic continuations and retains manual restarts',async()=>{
 const h=harness({ios:false,realResults:true});
 const lead='this rules can change with aquifer levels so residents should check so.org for the current stage if you see Water waste you can report it by calling to ';
 h.elements.note={value:'Typed starting note.',textContent:''};
 await h.run('toggleDictation()');
 for(const number of ['10','10-','10-70','10-704','10-704-7']){
  const session=h.sessions.at(-1);session.onresult({results:[[{transcript:lead+number}]]});
  assert.equal(h.elements.note.value,'Typed starting note. '+lead+number);
  session.onend();h.fire(250);
 }
 const last=h.sessions.at(-1),finalText=lead+'10-704-7283 come down the street is not allowed at any time of year.';
 last.onresult({results:[[{transcript:finalText}]]});
 assert.equal(h.elements.note.value,'Typed starting note. '+finalText);
 const finish=h.run('finishCaptureDictation()');last.onend();await finish;
 assert.equal(h.elements.note.value,'Typed starting note. '+finalText);
 await h.run('toggleDictation()');const manual=h.sessions.at(-1);
 manual.onresult({results:[[{transcript:lead+'10-704-7284'}]]});
 assert.equal(h.elements.note.value,'Typed starting note. '+finalText+' '+lead+'10-704-7284');
});

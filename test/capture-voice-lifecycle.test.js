const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('public/app.js','utf8');
function harness({ios=true,pending=false,exclusive=false,retainOnEnd=false}={}){
 const elements={},sessions=[],timers=new Map(),logs={};let next=0,permission,tracksStopped=0,owner;
 class Speech{constructor(){sessions.push(this);}start(){if(exclusive&&owner)throw new Error('Microphone still owned');owner=this;}stop(){this.stopped=true;}abort(){this.aborted=true;if(owner===this)owner=null;}set onend(handler){this.end=()=>{if(owner===this&&!retainOnEnd)owner=null;handler();};}get onend(){return this.end;}}
 const stream={getTracks:()=>[{stop:()=>tracksStopped++}]};
 const context=vm.createContext({Date,Promise,JSON,navigator:{userAgent:ios?'iPhone':'Android',onLine:true,mediaDevices:{getUserMedia:()=>pending?new Promise(r=>permission=r):Promise.resolve(stream)}},window:{SpeechRecognition:Speech},document:{visibilityState:'visible',getElementById:id=>elements[id]||=( {value:'',textContent:'',focus(){},classList:{add(){},remove(){}}})},localStorage:{getItem:k=>logs[k],setItem:(k,v)=>logs[k]=v},state:{photoFile:{}},uiSpeechLanguage:()=> 'en-US',isIndustryProClient:()=>false,toast(){},persistCaptureDraft:async()=>{},setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext("let recognizer=null,dictationActive=false,dictationRestartTimer=null,dictationWatchdog=null,dictationGeneration=0,dictationBase='',dictationFinish=null;"+source.slice(source.indexOf('let dictationEmptySessions'),source.indexOf('let currentGroupItems'))+"function combineSpeechResults(parts){return parts.join(' ');}function mergeSpeechTranscript(a,b){return (a+' '+b).trim();}"+source.slice(source.indexOf('function cleanupDictation()'),source.indexOf('// ================= Pro dimension fields')),context);
 return {run:c=>vm.runInContext(c,context),sessions,elements,timers,logs,resolve:()=>permission(stream),tracksStopped:()=>tracksStopped,fire:ms=>{for(const [id,t]of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}}};
}
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
  const s=h.sessions[i];const finishing=h.run('toggleDictation()');
  s.onresult({results:[[{transcript:`Phrase${i}`}]]});s.onend();await finishing;
  s.onresult({results:[[{transcript:'STALE WORDS'}]]});s.onend();s.onerror({error:'network'});
 }
 assert.equal(h.elements.note.value.replace(/\s+/g,' '),Array.from({length:40},(_,i)=>`Phrase${i}`).join(' '));assert.equal(h.timers.size,0);
});
test('late start callback cannot overwrite finishing status',async()=>{
 const h=harness();await h.run('toggleDictation()');const finishing=h.run('toggleDictation()');
 const status=h.elements.dictationStatus.textContent;h.sessions[0].onstart();assert.equal(h.elements.dictationStatus.textContent,status);assert.equal(h.elements.dictate.textContent,'Finishing Notes...');h.sessions[0].onend();await finishing;
});
test('interim results keep long speech alive, then speech end arms bounded completion',async()=>{
 const h=harness();await h.run('toggleDictation()');h.sessions[0].onspeechstart();h.sessions[0].onresult({results:[[{transcript:'Long speech',isFinal:false}]]});
 h.fire(30000);assert.equal(h.run('dictationActive'),true);h.sessions[0].onspeechend();h.fire(30000);assert.equal(h.run('dictationActive'),false);assert.ok(h.sessions[0].aborted);assert.equal(h.elements.note.value,'Long speech');
});
test('cancel pending microphone permission discards eventual stream',async()=>{
 const h=harness({ios:false,pending:true});const starting=h.run('toggleDictation()');await h.run('toggleDictation()');h.resolve();await starting;assert.equal(h.sessions.length,0);assert.equal(h.tracksStopped(),1);
});
test('stale error cannot stop a newer recording',async()=>{
 const h=harness();await h.run('toggleDictation()');const old=h.sessions[0];h.run('stopCaptureDictation()');await h.run('toggleDictation()');old.onerror({error:'network'});assert.equal(h.run('dictationActive'),true);
});
test('iPhone ends cleanly without automatic restart; Android resumes',async()=>{
 for(const ios of [true,false]){const h=harness({ios});await h.run('toggleDictation()');h.sessions[0].onend();h.fire(300);assert.equal(h.sessions.length,ios?1:2);}
});
test('fatal error resets without an end event; diagnostic log excludes words',async()=>{
 const h=harness();await h.run('toggleDictation()');h.sessions[0].onresult({results:[[{transcript:'Private note text'}]]});h.sessions[0].onerror({error:'network'});assert.equal(h.elements.dictate.textContent,'Record Notes');assert.equal(h.elements.note.value,'Private note text');assert.ok(!h.logs.photoNotesSpeechDiagnostics.includes('Private note text'));
});
test('Save awaits completion before reading the note',()=>{assert.match(source,/async function saveCaptureDurably\(options = \{\}\) \{\s+await finishCaptureDictation\(\);\s+stopCaptureDictation\(\);\s+const note/);});

test('a delayed result without end does not cancel the finishing deadline',async()=>{
 const h=harness();await h.run('toggleDictation()');const finish=h.run('finishCaptureDictation()');h.sessions[0].onresult({results:[[{transcript:'Kept words'}]]});h.fire(8000);await finish;assert.equal(h.elements.note.value,'Kept words');assert.equal(h.elements.dictate.textContent,'Record Notes');
});

test('Android empty sessions stop after three attempts instead of looping forever',async()=>{
 const h=harness({ios:false});await h.run('toggleDictation()');for(let i=0;i<3;i++){h.sessions[i].onend();h.fire(300);}assert.equal(h.sessions.length,3);assert.equal(h.run('dictationActive'),false);assert.equal(h.elements.dictate.textContent,'Record Notes');
});

test('Safari end can retain its engine until abort; consecutive sessions explicitly release it',async()=>{
 const h=harness({exclusive:true,retainOnEnd:true});
 for(let i=0;i<10;i++){await h.run('toggleDictation()');const s=h.sessions.at(-1);assert.equal(h.run('dictationActive'),true);s.onresult({results:[[{transcript:'Recording '+i}]]});const stopping=h.run('toggleDictation()');s.onend();await stopping;assert.equal(s.aborted,true);}
 assert.equal(h.sessions.length,10);assert(h.elements.note.value.includes('Recording 9'));
});

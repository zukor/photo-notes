const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('public/app.js','utf8');
function harness({ios=true,pending=false}={}){
  const elements={},recorders=[],sessions=[],requests=[],timers=[];
  let resolvePermission,stopped=0;
  const stream={getTracks:()=>[{stop:()=>stopped++}]};
  class Recorder{
    static isTypeSupported(){return true;}
    constructor(){this.state='inactive';this.mimeType='audio/mp4';recorders.push(this);}
    start(){this.state='recording';}
    stop(){this.state='inactive';}
    finish(){this.ondataavailable({data:new Blob(['audio'])});this.onstop();}
  }
  class Speech{
    constructor(){sessions.push(this);}
    start(){}
    stop(){}
  }
  const context=vm.createContext({
    Blob,FormData,MediaRecorder:Recorder,
    navigator:{userAgent:'test',mediaDevices:{getUserMedia:()=>pending?new Promise(r=>resolvePermission=r):Promise.resolve(stream)}},
    window:{MediaRecorder:Recorder,SpeechRecognition:Speech,innerWidth:390,innerHeight:844},
    document:{getElementById:id=>elements[id]||=( {value:'',hidden:false,disabled:false,textContent:'',focus(){},classList:{add(){},remove(){}}}),querySelector:()=>({})},
    state:{view:'capture'},isIOS:()=>ios,uiSpeechLanguage:()=> 'en-US',issueFabLabel:()=> 'Report an Issue',
    toast(){},location:{href:'https://example.test/'},
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},
    api:async(url,options)=>{requests.push(options.body);return {ok:true,json:async()=>({id:1})};}
  });
  vm.runInContext(source.slice(source.indexOf('let issueScreenshotBlob'),source.indexOf('function areaChips()')),context);
  return {run:code=>vm.runInContext(code,context),elements,recorders,sessions,requests,timers,resolve:()=>resolvePermission(stream),stopped:()=>stopped};
}
test('sending during recording waits for the final audio blob, then includes it',async()=>{
  const h=harness();await h.run('openIssueReporter()');await h.run('toggleIssueDictation()');
  await h.run('submitIssueReport()');assert.equal(h.requests.length,0);
  h.recorders[0].finish();await h.run('submitIssueReport()');
  assert.equal(h.requests.length,1);assert.equal(await h.requests[0].get('voice').text(),'audio');assert.ok(h.stopped());
});
test('closing while permission is pending releases the eventual stream',async()=>{
  const h=harness({pending:true});await h.run('openIssueReporter()');
  const permission=h.run('toggleIssueDictation()');h.run('closeIssueReporter()');h.resolve();await permission;
  assert.equal(h.recorders.length,0);assert.equal(h.stopped(),1);
});
test('old recorder completion cannot contaminate a reopened report or stop its stream',async()=>{
  const h=harness();await h.run('openIssueReporter()');await h.run('toggleIssueDictation()');
  h.run('closeIssueReporter()');await h.run('openIssueReporter()');await h.run('toggleIssueDictation()');
  h.recorders[0].finish();assert.equal(h.run('issueVoiceBlob'),null);
  assert.equal(h.run('issueMediaRecorder.state'),'recording');
});
test('Android final results are included before send and stale sessions are ignored',async()=>{
  const h=harness({ios:false});await h.run('openIssueReporter()');await h.run('toggleIssueDictation()');
  const session=h.sessions[0];await h.run('submitIssueReport()');assert.equal(h.requests.length,0);
  session.onresult({results:[[{transcript:'The button did not work'}]]});session.onend();
  await h.run('submitIssueReport()');assert.match(h.requests[0].get('description'),/The button did not work/);
  h.run('closeIssueReporter()');await h.run('openIssueReporter()');
  session.onresult({results:[[{transcript:'stale text'}]]});session.onend();
  assert.equal(h.elements.issueDescription.value,'');
  h.timers.forEach(fn=>fn());assert.equal(h.elements.issueModal.hidden,false);
});
test('repeated permission taps start only one recorder',async()=>{
  const h=harness({pending:true});await h.run('openIssueReporter()');
  const first=h.run('toggleIssueDictation()');await h.run('toggleIssueDictation()');
  h.resolve();await first;assert.equal(h.recorders.length,1);
});

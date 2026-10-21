// Live Record Notes in the real Capture screen with a real (fake-device) microphone,
// real AudioContext/AudioWorklet capture and resampling, and a stand-in transcription
// socket. No provider calls. Chromium only: it is the engine whose fake microphone
// Playwright supports on Linux. Physical iPhone/Android acceptance remains separate.
const express=require('express'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const app=express();app.use(express.static(require('node:path').join(__dirname,'../public')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 try{for(const [label,ua,width] of [['iPhone','Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',390],['Android','Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile',390],['desktop','Mozilla/5.0 (Macintosh) Chrome/130',1440]]){
  const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block',userAgent:ua});
  page.on('pageerror',e=>console.log('pageerror',e.message));
  const uploads=[],outcomes=[];let recordingMode='ok';
  await page.addInitScript(()=>{
   localStorage.setItem('pn_install_prompt_dismissed_v1','1');localStorage.setItem('pn_first_use_v1:'+encodeURIComponent('live@example.invalid'),'done');
   // Stand-in for the transcription socket: counts streamed audio and replies with turns.
   window.socketLog=[];window.socketMode='normal';
   window.WebSocket=class{constructor(url){this.url=url;this.readyState=0;this.bytes=0;this.turn=0;window.socketLog.push(this);setTimeout(()=>{if(window.socketMode==='refuse'){this.readyState=3;this.onclose?.({code:1006});return;}this.readyState=1;this.onopen?.();},30);}
    send(data){if(typeof data==='string'){const m=JSON.parse(data);if(m.type==='Terminate'){this.terminated=true;setTimeout(()=>{this.onmessage?.({data:JSON.stringify({type:'Turn',turn_order:this.turn,transcript:window.nextFinal||`Final words ${window.socketLog.indexOf(this)}.`,end_of_turn:true,turn_is_formatted:true})});this.onmessage?.({data:JSON.stringify({type:'Termination'})});},50);}return;}
     this.bytes+=data.byteLength;
     if(window.socketMode==='drop'&&this.bytes>16000*2){this.readyState=3;this.onclose?.({code:1006});return;}
     if(this.bytes%(3200*5)===0)this.onmessage?.({data:JSON.stringify({type:'Turn',turn_order:this.turn,transcript:'live words '+this.turn,end_of_turn:false})});}
    close(){this.readyState=3;}};
  });
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),path=url.pathname;
   if(path==='/api/transcription/outcome'){outcomes.push(JSON.parse(route.request().postData()));return route.fulfill({json:{ok:true}});}
   if(path==='/api/transcription/config')return route.fulfill({json:{live:true,provider:'assemblyai'}});
   if(path==='/api/transcription/session')return route.fulfill({json:{url:'wss://streaming.assemblyai.com/v3/ws?token=t&format_turns=true',sampleRate:16000}});
   if(path==='/api/transcription/recording'){const body=route.request().postDataBuffer();uploads.push(body);return recordingMode==='ok'?route.fulfill({json:{text:'Recovered from the recording.',seconds:3}}):route.fulfill({status:502,json:{error:'down'}});}
   return route.fulfill({json:path==='/api/me'?{id:1,name:'Test',email:'live@example.invalid',plan:'pro',pro_type:'general',role:'user',edition_access:['pro']}:path==='/api/customer-feedback/access'?{enabled:true}:path==='/api/billing/config'?{checkout_enabled:false}:path==='/api/hoa/context'?{communities:[],members:[]}:[]});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>state.me);
  await page.waitForFunction(()=>window.PhotoNotesLiveTranscription?.enabled());
  await page.evaluate(()=>{document.getElementById('firstUseSetup')?.close();stopCaptureDictation();state.plan='pro';state.proType='general';state.view='capture';renderApp();});
  await page.locator('#dictate').waitFor();
  assert.equal(await page.locator('#dictate').isDisabled(),false,'live mode does not wait for the iPhone speech document');
  // 1. Normal live note: words appear while speaking, Stop adds the final words.
  await page.locator('#note').fill('Typed first.');
  await page.locator('#dictate').click();
  await page.waitForFunction(()=>document.getElementById('dictate').textContent.includes('Recording'));
  await page.waitForFunction(()=>document.getElementById('note').value.includes('live words 0'),null,{timeout:15000});
  const streamed=await page.evaluate(()=>socketLog[0].bytes);
  assert.ok(streamed>=3200*5,'real microphone audio is streamed as 16 kHz PCM');
  await page.locator('#dictate').click();
  await page.waitForFunction(()=>document.getElementById('dictate').textContent==='Record Notes'&&!document.getElementById('dictate').disabled);
  assert.equal(await page.locator('#note').inputValue(),'Typed first. Final words 0.');
  assert.equal(uploads.length,0,'no recording upload when live text completed');
  // 2. Second and third recordings without reload (the reported iPhone failure pattern).
  for(let i=0;i<2;i++){
   await page.locator('#dictate').click();await page.waitForFunction(n=>socketLog.length===n&&socketLog[n-1].bytes>3200*5,i+2,{timeout:15000});
   await page.locator('#dictate').click();await page.waitForFunction(()=>document.getElementById('dictate').textContent==='Record Notes'&&!document.getElementById('dictate').disabled);
  }
  assert.equal(await page.locator('#note').inputValue(),'Typed first. Final words 0. Final words 1. Final words 2.');
  // 3. Connection drops mid-note: recording continues, saved audio fills in after Stop.
  await page.evaluate(()=>{socketMode='drop';document.getElementById('note').value='';state._note='';});
  await page.locator('#dictate').click();
  await page.waitForFunction(()=>document.getElementById('dictationStatus').textContent.includes('Connection lost'),null,{timeout:15000});
  await page.waitForTimeout(1500);
  assert.match(await page.locator('#dictate').textContent(),/Recording/,'still recording after the drop');
  await page.locator('#dictate').click();
  await page.waitForFunction(()=>document.getElementById('note').value==='Recovered from the recording.',null,{timeout:15000});
  assert.equal(uploads.length,1);const wav=uploads[0];
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(24),16000);
  assert.ok(wav.readUInt32LE(40)/32000>=2,'whole recording uploaded, including after the drop');
  // 4. Transcription unavailable too: recording kept, retry adds the words.
  await page.evaluate(()=>{socketMode='refuse';document.getElementById('note').value='';state._note='';});recordingMode='fail';
  await page.locator('#dictate').click();await page.waitForTimeout(1500);await page.locator('#dictate').click();
  await page.locator('#dictationRetryTranscription').waitFor({timeout:15000});
  assert.match(await page.locator('#dictationStatus').textContent(),/saved on this device/);
  recordingMode='ok';await page.locator('#dictationRetryTranscription').click();
  await page.waitForFunction(()=>document.getElementById('note').value==='Recovered from the recording.');
  assert.equal(await page.locator('#dictationRetryTranscription').count(),0);
  // 5. Save while recording waits for final words.
  await page.evaluate(()=>{socketMode='normal';document.getElementById('note').value='';state._note='';});
  await page.locator('#dictate').click();await page.waitForFunction(()=>document.getElementById('dictate').textContent.includes('Recording'));await page.waitForTimeout(800);
  await page.evaluate(()=>{window.finished=false;finishCaptureDictation().then(()=>window.finished=true);});
  await page.waitForFunction(()=>window.finished,null,{timeout:15000});
  assert.match(await page.locator('#note').inputValue(),/Final words/);
  await page.screenshot({path:`output/live-record-notes-${label}.png`});
  // 6. Send Feedback dictation uses the same live engine, after a Capture recording, then Capture again.
  await page.evaluate(()=>{socketMode='normal';refreshCustomerFeedback();});
  await page.locator('#feedbackFab').waitFor();await page.locator('#feedbackFab').click();
  await page.locator('#feedbackDictate').click();
  await page.waitForFunction(()=>/live words/.test(document.getElementById('feedbackDescription').value),null,{timeout:15000});
  await page.locator('#feedbackDictate').click();
  await page.waitForFunction(()=>/Final words \d+\./.test(document.getElementById('feedbackDescription').value)&&document.getElementById('feedbackDictate').textContent==='Dictate feedback',null,{timeout:15000});
  await page.locator('#feedbackCancel').click();
  await page.evaluate(()=>{document.getElementById('note').value='';state._note='';});
  await page.locator('#dictate').click();await page.waitForFunction(()=>/live words/.test(document.getElementById('note').value),null,{timeout:15000});
  await page.locator('#dictate').click();await page.waitForFunction(()=>/Final words/.test(document.getElementById('note').value)&&document.getElementById('dictate').textContent==='Record Notes');
  // 7. Report Issue description: live text on every device, including iPhone (no audio attachment).
  await page.evaluate(()=>openIssueReporter());await page.locator('#issueRecord').waitFor();
  await page.locator('#issueRecord').click();
  await page.waitForFunction(()=>/live words/.test(document.getElementById('issueDescription').value),null,{timeout:15000});
  await page.locator('#issueRecord').click();
  await page.waitForFunction(()=>/Final words \d+\./.test(document.getElementById('issueDescription').value)&&!document.getElementById('issueRecord').classList.contains('on'),null,{timeout:15000});
  await page.evaluate(()=>closeIssueReporter());
  // 8. Extra Work description.
  await page.evaluate(()=>{state.plan='pro';state.proType='paving';state.ewrId='new';renderEwrDetail();});
  await page.locator('#ewrDictate').waitFor();await page.locator('#ewrDictate').click();
  await page.waitForFunction(()=>/live words/.test(document.getElementById('ewrDesc').value),null,{timeout:15000});
  await page.locator('#ewrDictate').click();
  await page.waitForFunction(()=>/Final words \d+\./.test(document.getElementById('ewrDesc').value)&&document.getElementById('ewrDictate').textContent==='Record Voice Note',null,{timeout:15000});
  assert.equal(await page.evaluate(()=>socketLog.filter(s=>!s.terminated&&s.readyState===1).length),0,'every live session terminated');
  // 9. Every recording reported a content-free outcome.
  assert.ok(outcomes.length>=8,'outcomes reported: '+outcomes.length);
  assert.ok(outcomes.some(o=>o.outcome==='live'&&o.surface==='capture'));
  assert.ok(outcomes.some(o=>o.outcome==='recovered'));
  assert.ok(outcomes.some(o=>o.outcome==='kept'));
  assert.ok(['feedback','issue','ewr'].every(surface=>outcomes.some(o=>o.surface===surface)));
  assert.equal(JSON.stringify(outcomes).includes('Final words'),false,'no words in outcomes');
  if(label==='iPhone'){
   // 10. Leaving the screen: recording pauses, the audio so far is saved and transcribed
   // when the app is back, replacing the live words, and Continue Recording keeps going.
   await page.evaluate(()=>{socketMode='normal';state.view='capture';renderApp();document.getElementById('note').value='Typed first.';state._note='Typed first.';window.__hidden=false;
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__hidden?'hidden':'visible'});Object.defineProperty(document,'hidden',{configurable:true,get:()=>!!window.__hidden});});
   recordingMode='ok';const before=uploads.length,reported=outcomes.length;
   await page.locator('#dictate').click();
   await page.waitForFunction(()=>/live words/.test(document.getElementById('note').value),null,{timeout:15000});
   await page.evaluate(()=>{window.__hidden=true;document.dispatchEvent(new Event('visibilitychange'));});
   await page.locator('#dictationInterruptedDialog').waitFor({timeout:10000});
   assert.equal(await page.locator('#dictationInterruptedTitle').textContent(),'Recording paused');
   assert.equal(await page.locator('#dictationRestart').textContent(),'Continue Recording');
   assert.equal(await page.locator('#dictationRestart').isDisabled(),false,'Continue Recording is ready at once');
   assert.match(await page.locator('#dictationInterruptedReason').textContent(),/Phones do not let web apps record in the background\. Your words so far are saved\./);
   assert.match(await page.locator('#dictationStatus').textContent(),/saved on this device/);
   await page.waitForTimeout(1500);
   assert.equal(uploads.length,before,'nothing is sent while the app is off screen');
   assert.equal(await page.evaluate(async()=>(await PhotoNotesLiveTranscription.listKept()).filter(i=>i.status==='pending').length),1,'audio saved on the device at once');
   await page.evaluate(()=>{window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'));});
   await page.waitForFunction(()=>document.getElementById('note').value==='Typed first. Recovered from the recording.',null,{timeout:15000});
   assert.equal(uploads.length,before+1);
   assert.ok(outcomes.slice(reported).some(o=>o.outcome==='recovered'&&o.reason==='background'&&o.cause==='background'&&o.interrupted===true),'background outcome reported');
   await page.locator('#dictationRestart').click();
   await page.waitForFunction(()=>document.getElementById('dictate').textContent.includes('Recording')&&/live words/.test(document.getElementById('note').value),null,{timeout:15000});
   await page.locator('#dictate').click();
   await page.waitForFunction(()=>/^Typed first\. Recovered from the recording\. Final words \d+\.$/.test(document.getElementById('note').value)&&document.getElementById('dictate').textContent==='Record Notes',null,{timeout:15000});
   assert.equal(await page.evaluate(async()=>(await PhotoNotesLiveTranscription.listKept()).length),0,'removed from the device once transcribed');
   // 11. A saved recording survives closing the app and is recovered at the next open.
   await page.evaluate(()=>{socketMode='refuse';state.view='capture';renderApp();document.getElementById('note').value='';});recordingMode='fail';
   await page.locator('#dictate').click();await page.waitForTimeout(1500);await page.locator('#dictate').click();
   await page.locator('#dictationRetryTranscription').waitFor({timeout:20000});
   assert.equal(await page.evaluate(async()=>(await PhotoNotesLiveTranscription.listKept()).filter(i=>i.status==='pending').length),1,'saved on the device');
   recordingMode='ok';
   await page.reload();await page.waitForFunction(()=>state.me);
   await page.locator('#recoveredRecordingsDialog').waitFor({timeout:20000});
   assert.match(await page.locator('#recoveredList').textContent(),/Recovered from the recording\./);
   await page.locator('[data-recovered-discard]').click();
   await page.waitForFunction(()=>!document.getElementById('recoveredRecordingsDialog'));
   assert.equal(await page.evaluate(async()=>(await PhotoNotesLiveTranscription.listKept()).length),0,'removed from the device');
   // 12. Self-test page: ten recordings in a row with automatic pass/fail.
   await page.goto(`http://127.0.0.1:${server.address().port}/record-notes-self-test.html`);
   await page.evaluate(()=>{socketMode='normal';});
   await page.locator('#selfTestRecord').waitFor();
   for(let i=0;i<10;i++){
    await page.locator('#selfTestRecord').click();
    await page.waitForFunction(()=>document.getElementById('selfTestRecord').textContent==='Stop');
    await page.evaluate(()=>{window.nextFinal=document.getElementById('selfTestSentence').textContent;});
    await page.waitForTimeout(400);
    await page.locator('#selfTestRecord').click();
    await page.waitForFunction(n=>document.querySelectorAll('#selfTestResults tbody tr').length===n,i+1,{timeout:15000});
   }
   assert.equal(await page.locator('#selfTestSummary').textContent(),'All 10 tests passed.');
   assert.equal(outcomes.filter(o=>o.surface==='selftest').length,10);
   await page.screenshot({path:'/tmp/live-self-test.png',fullPage:true});
  }
  await page.close();
  console.log(label+': live words, Stop final words, repeated recordings, dropped connection recovery, retry, finish-before-save, Feedback and Capture handoff, Report Issue and Extra Work, outcomes'+(label==='iPhone'?', background pause and Continue Recording, saved recording across reload, self-test':'')+' passed');
 }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});

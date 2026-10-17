const {chromium,webkit}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http');
{const version=(fs.readFileSync('public/index.html','utf8').match(/first-use\.js\?v=(\d+)/)||[])[1];assert.ok(version,'index.html loads first-use.js');assert.ok(fs.readFileSync('public/sw.js','utf8').includes('/first-use.js?v='+version),'the offline cache uses the same first-use.js version');}
const server=http.createServer((req,res)=>res.end('<html><body>PhotoNotes</body></html>'));
const engines=(process.env.PN_FIRST_USE_ENGINES||'chromium,webkit').split(',').map(name=>({chromium,webkit})[name]);
async function setup(page,{ua='iPhone',email='tester@example.invalid'}={}){
 await page.evaluate(email=>{window.state={me:{email}};window.calls=[];window.stops=0;window.mediaMode='allow';window.locationMode='allow';
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(ok,fail,options)=>{calls.push({location:options});if(locationMode==='allow')ok({coords:{latitude:29,longitude:-98}});else fail({code:locationMode==='deny'?1:3});}}});
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async options=>{calls.push(options);
   if(mediaMode==='deny-camera'&&options.video)throw new DOMException('denied','NotAllowedError');
   if(mediaMode==='deny')throw new DOMException('denied','NotAllowedError');
   return {getTracks:()=>[{stop:()=>stops++},...(options.audio&&options.video?[{stop:()=>stops++}]:[])]};}}});
 },email);
}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));
for(const engine of engines){const browser=await engine.launch();
 for(const ua of ['iPhone','Android']){
 const page=await browser.newPage({viewport:{width:390,height:844},userAgent:ua});page.setDefaultTimeout(10000);page.on('pageerror',e=>console.log('pageerror',e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.addStyleTag({path:'public/styles.css'});
 await setup(page,{ua});await page.addScriptTag({path:'public/first-use.js'});
 // One screen, nothing requested until the person taps.
 await page.evaluate(()=>PhotoNotesFirstUse.offer(state.me));
 assert.equal(await page.locator('#firstUseTitle').textContent(),'Set up PhotoNotes');
 assert.equal(await page.locator('#firstUseYes').textContent(),'Turn On Everything');
 assert.equal(await page.locator('.first-use-item').count(),3);
 assert.equal(await page.evaluate(()=>calls.length),0);
 // One tap: combined camera+microphone request, then location, then Home Screen step.
 await page.locator('#firstUseYes').click();
 await page.waitForFunction(()=>document.querySelector('#firstUseTitle')?.textContent==='Add PhotoNotes to your Home Screen');
 const calls=await page.evaluate(()=>calls);
 assert.equal(calls.length,2);assert.equal(calls[0].audio,true);assert.ok(calls[0].video);assert.equal(calls[1].location.timeout,15000);
 assert.equal(await page.evaluate(()=>stops),2,'all tracks released immediately');
 const steps=await page.locator('#firstUseIcon').textContent();
 if(ua==='iPhone'){assert.match(steps,/Share button/);assert.match(steps,/Add to Home Screen/);assert.match(steps,/Turn On Everything there once more/);assert.equal(await page.locator('#firstUseYes').isHidden(),true);}
 else assert.match(steps,/three dots menu in Chrome/);
 await page.screenshot({path:`/tmp/photonotes-first-use-${engine.name()}-${ua}.png`});
 await page.locator('#firstUseNext').click();await page.waitForFunction(()=>!document.querySelector('dialog'));
 assert.equal(await page.evaluate(()=>PhotoNotesFirstUse.offer(state.me)),false,'shown once per account');
 // Android offers the browser install prompt from a second tap.
 if(ua==='Android'){
  await page.evaluate(()=>{state.me.email='prompt@example.invalid';window.prompted=0;window.deferredInstallPrompt={prompt:async()=>{prompted++;},userChoice:Promise.resolve({outcome:'accepted'})};PhotoNotesFirstUse.offer(state.me);});
  await page.locator('#firstUseYes').click();await page.waitForFunction(()=>document.querySelector('#firstUseYes')?.textContent==='Add to Home Screen');
  await page.locator('#firstUseYes').click();await page.waitForFunction(()=>!document.querySelector('dialog'));assert.equal(await page.evaluate(()=>prompted),1);
 }
 // Camera refused: microphone still turns on separately; summary explains, Try Again offered.
 await page.evaluate(()=>{state.me.email='camera-denied@example.invalid';mediaMode='deny-camera';calls.length=0;PhotoNotesFirstUse.offer(state.me);});
 await page.locator('#firstUseYes').click();await page.waitForFunction(()=>document.querySelector('#firstUseStatus').textContent.includes('Not turned on'));
 assert.equal(await page.locator('[data-permission=microphone] .first-use-state').textContent(),'On');
 assert.equal(await page.locator('[data-permission=camera] .first-use-state').textContent(),'Not allowed');
 assert.equal(await page.locator('[data-permission=location] .first-use-state').textContent(),'On');
 assert.match(await page.locator('#firstUseStatus').textContent(),/Camera/);
 assert.equal(await page.locator('#firstUseYes').textContent(),'Try Again');
 await page.evaluate(()=>mediaMode='allow');await page.locator('#firstUseYes').click();
 await page.waitForFunction(()=>document.querySelector('#firstUseTitle')?.textContent==='Add PhotoNotes to your Home Screen');
 await page.locator('#firstUseNext').click();await page.waitForFunction(()=>!document.querySelector('dialog'));
 // Location timeout reports could-not-turn-on, never blocks the app.
 await page.evaluate(()=>{state.me.email='slow-gps@example.invalid';locationMode='timeout';PhotoNotesFirstUse.offer(state.me);});
 await page.locator('#firstUseYes').click();await page.waitForFunction(()=>document.querySelector('[data-permission=location] .first-use-state')?.textContent==='Could not turn on');
 await page.locator('#firstUseNext').click();await page.locator('#firstUseNext').click();await page.waitForFunction(()=>!document.querySelector('dialog'));
 // Not Now skips straight to the icon step, then Done closes.
 await page.evaluate(()=>{state.me.email='skip@example.invalid';locationMode='allow';calls.length=0;PhotoNotesFirstUse.offer(state.me);});
 await page.locator('#firstUseNext').click();assert.equal(await page.locator('#firstUseTitle').textContent(),'Add PhotoNotes to your Home Screen');
 await page.locator('#firstUseNext').click();await page.waitForFunction(()=>!document.querySelector('dialog'));assert.equal(await page.evaluate(()=>calls.length),0);
 // Installed app: no icon step; Done after permissions.
 await page.evaluate(()=>{state.me.email='installed@example.invalid';Object.defineProperty(navigator,'standalone',{configurable:true,value:true});PhotoNotesFirstUse.offer(state.me);});
 await page.locator('#firstUseYes').click();await page.waitForFunction(()=>document.querySelector('#firstUseStatus').textContent==='Everything is on.');
 assert.equal(await page.locator('#firstUseNext').textContent(),'Done');await page.locator('#firstUseNext').click();await page.waitForFunction(()=>!document.querySelector('dialog'));
 // Account switch while prompts are open must not continue for the other account.
 await page.evaluate(()=>{state.me.email='switch@example.invalid';calls.length=0;navigator.mediaDevices.getUserMedia=()=>new Promise(r=>setTimeout(()=>r({getTracks:()=>[{stop(){}}]}),200));PhotoNotesFirstUse.offer(state.me);});
 await page.locator('#firstUseYes').click();await page.evaluate(()=>{state.me={email:'someone-else@example.invalid'};});await page.waitForTimeout(400);
 assert.equal(await page.evaluate(()=>calls.some(c=>c.location)),false,'stale account setup stops before location');
 await page.close();
 }
 // Every edition at phone and desktop width gets the same one-tap setup.
 const page=await browser.newPage({viewport:{width:390,height:844},userAgent:'iPhone'});await page.goto('http://127.0.0.1:'+server.address().port);await page.addStyleTag({path:'public/styles.css'});await setup(page);await page.addScriptTag({path:'public/first-use.js'});
 for(const width of [390,1440]){await page.setViewportSize({width,height:900});for(const [edition,choice] of Object.entries(require('../editions').EDITIONS)){
  await page.evaluate(({edition,choice,width})=>{state.me={email:edition+width+'@matrix.invalid',...choice};PhotoNotesFirstUse.offer(state.me);},{edition,choice,width});
  await page.locator('#firstUseYes').click();await page.waitForFunction(()=>document.querySelector('#firstUseTitle')?.textContent==='Add PhotoNotes to your Home Screen');
  await page.locator('#firstUseNext').click();await page.waitForFunction(()=>!document.querySelector('dialog'));}}
 await browser.close();console.log(engine.name()+': one-tap permissions, combined camera and microphone, partial refusal, retry, location timeout, skip, install prompt, iPhone steps, installed app, account switch, all editions passed');}
server.close();})().catch(e=>{console.error(e);process.exit(1);});

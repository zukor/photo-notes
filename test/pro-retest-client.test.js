const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/app.js','utf8');
test('an earlier search cannot overwrite Clear results',async()=>{
 const cards={innerHTML:''},status={},nodes={cards,photoSearchStatus:status};let resolveOld;
 const c={document:{getElementById:id=>nodes[id]},URLSearchParams,api:()=>new Promise(r=>resolveOld=r)};vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('let cardsRequest ='),source.indexOf('function formatGpsClient')),c);
 const old=c.loadCards('','roof');c.api=async()=>({ok:true,json:async()=>[]});await c.loadCards('');const cleared=cards.innerHTML;
 resolveOld({ok:true,json:async()=>[{id:9}]});await old;assert.equal(cards.innerHTML,cleared);assert.equal(status.textContent,'');
});
test('Clear resets query, topic, job, dates and missing-address filter together',()=>{
 const nodes=Object.fromEntries(['photoSearch','filter','jobFilter','searchFrom','searchTo','searchMissingAddress'].map(id=>[id,{value:'active',checked:true}]));let called=0;
 const c={document:{getElementById:id=>nodes[id]},runSmartSearch:()=>called++};
 const start=source.indexOf("document.getElementById('photoSearchClear').onclick=()=>{")+"document.getElementById('photoSearchClear').onclick=()=>{".length;
 vm.runInNewContext(source.slice(start,source.indexOf('};',start)),c);
 for(const id of ['photoSearch','filter','jobFilter','searchFrom','searchTo'])assert.equal(nodes[id].value,'');assert.equal(nodes.searchMissingAddress.checked,false);assert.equal(called,1);
});
test('failed markup saves retain the draft and permit retry',async()=>{
 const button={disabled:false},messages=[],capture={id:4,overlays:[]},overlays=[{t:'rect',x:3}];
 const c={document:{getElementById:()=>button},editorCapture:capture,editorOverlays:overlays,state:{},toast:m=>messages.push(m),api:async()=>{throw Error('offline');}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('async function saveOverlays'),source.indexOf('async function saveStampedCopy')),c);
 assert.equal(await c.saveOverlays(),false);assert.equal(button.disabled,false);assert.equal(capture.overlays.length,0);assert.equal(c.editorOverlays.length,1);assert.equal(messages.at(-1),'Save failed');
 c.api=async()=>({ok:true,json:async()=>({overlays})});assert.equal(await c.saveOverlays(),true);assert.equal(capture.overlays.length,1);
});

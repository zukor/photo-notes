const {chromium,webkit}=require('playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const source=fs.readFileSync('public/send.js','utf8');
for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [390,1440]){
const page=await browser.newPage({viewport:{width,height:900}});
await page.setContent('<button id="send">Send/Share</button><style>'+fs.readFileSync('public/styles.css','utf8')+'</style>');
await page.addScriptTag({content:'var tr=x=>x,q=id=>document.getElementById(id);'+source.slice(source.indexOf('  function showCaptureResult('),source.indexOf('  var sending'))});
for(const outcome of ['shared','canceled','failed','prepared']){
await page.evaluate(outcome=>{window.receipt={uploaded:false};const modal=document.createElement('div');modal.className='export-share-modal';document.body.append(modal);showCaptureResult(modal,receipt,outcome);},outcome);
if(outcome==='shared')await page.screenshot({path:`/tmp/capture-result-${engine.name()}-${width}.png`});
const dialog=page.getByRole('alertdialog');assert(await dialog.isVisible());const box=await dialog.boundingBox();assert(Math.abs(box.x+box.width/2-width/2)<2);assert(Math.abs(box.y+box.height/2-450)<2);
assert.equal(await dialog.evaluate(el=>getComputedStyle(el).color),'rgb(0, 0, 0)');assert.match(await dialog.innerText(),/pending upload queue/);
await page.keyboard.press('Escape');assert(await dialog.isVisible());
await page.evaluate(()=>receipt.uploaded=true);await page.waitForFunction(()=>document.getElementById('captureSaveResult').textContent.includes('Find it in Library'));
await page.getByRole('button',{name:'OK',exact:true}).click();assert.equal(await dialog.count(),0);
}
await page.close();console.log(engine.name()+' '+width+': centered result, save status, and explicit OK PASS');
}}finally{await browser.close();}}})().catch(e=>{console.error(e);process.exitCode=1;});

const fs=require('node:fs'),sharp=require('sharp');
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const express=require('express');
(async()=>{
 const app=express();app.get('/vendor/html2canvas.min.js',(_,res)=>res.sendFile(require.resolve('html2canvas/dist/html2canvas.min.js')));app.use(express.static(require('node:path').join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{
 for(const width of [390,1440]){const role='user';
 const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'});const errors=[];let sent=false;console.log('Starting',engine.name(),role);page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;let data=[];
 if(path==='/api/me')data={id:1,name:'Test',role:role==='user'?'user':'admin',is_super_admin:role==='super',plan:'pro',edition_access:['basic','pro']};
 if(path==='/api/issues/attention')data={count:0};if(path==='/api/admin/usage')data={};
 if(path==='/api/admin/issues')data=Array.from({length:150},(_,n)=>({id:n+1,page_name:'Organize',description:'What happened: Test issue',management_status:'new',issue_type:'bug_problem',priority:'normal'}));
 if(path==='/api/issues'&&route.request().method()==='POST'){sent=true;data={id:999,email_status:'sent'};}
 return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});});
 await page.goto(`http://127.0.0.1:${server.address().port}/${role==='user'?'':'admin.html'}`);await page.locator('#issueFab').waitFor();
 if(role!=='user'){await page.locator('[data-admin-tool="issues"] > summary').click();await page.locator('.issue-admin-card').first().waitFor();}
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:`/tmp/pn-header-${engine.name()}-${width}-native.png`});
 const rect=await page.locator('.zukor-corner-logo').boundingBox();
 await page.evaluate(async()=>{window.shot=await captureIssueScreenshot(1);});
 const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await window.shot.arrayBuffer())));fs.writeFileSync(`/tmp/pn-header-${engine.name()}-${width}-capture.jpg`,Buffer.from(bytes));
 const crop={left:Math.round(rect.x),top:Math.round(rect.y),width:Math.floor(rect.width),height:Math.floor(rect.height)};
 const native=await sharp(`/tmp/pn-header-${engine.name()}-${width}-native.png`).extract(crop).removeAlpha().raw().toBuffer();
 const captured=await sharp(Buffer.from(bytes)).extract(crop).removeAlpha().raw().toBuffer();
 function ink(data){let count=0,left=crop.width,right=0,top=crop.height,bottom=0;for(let i=0;i<data.length;i+=3){if(data[i]<90&&data[i+1]<90&&data[i+2]<90){const x=(i/3)%crop.width,y=Math.floor(i/3/crop.width);count++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}return {count,left,right,top,bottom};}
 const expected=ink(native),actual=ink(captured);assert(expected.count>50);assert(actual.count/expected.count>0.7&&actual.count/expected.count<1.3,'complete logo artwork must be preserved');for(const edge of ['left','right','top','bottom'])assert(Math.abs(expected[edge]-actual[edge])<=4,'logo bounds must match screen');
 console.log(engine.name(),width,'logo bounds and artwork match');
 await page.close();console.log(engine.name(),width,'header capture PASS');
 }
 }finally{await browser.close();}}}finally{server.close();}
})().catch(e=>{console.error(e);process.exit(1);});

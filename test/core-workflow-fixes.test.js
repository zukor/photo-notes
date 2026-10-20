// Photo Notes Basic and general Pro workflow fixes: library photo dates, document branding, copyright,
// urgency in documents, failed download navigation, and capture-sharing details.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),http=require('node:http');
const app=fs.readFileSync('public/app.js','utf8'),server=fs.readFileSync('server.js','utf8'),send=fs.readFileSync('public/send.js','utf8');
const slice=(source,from,to)=>{const a=source.indexOf(from);assert.ok(a>=0,from);const b=source.indexOf(to,a+from.length);assert.ok(b>a,to);return source.slice(a,b);};
const Location=require('../public/photo-location.js');

// A minimal little-endian EXIF block: IFD0 points to an Exif IFD holding DateTimeOriginal and, optionally, OffsetTimeOriginal.
function exifWithDate(date,offset){
  const tiff=Buffer.alloc(100);tiff.write('II',0,'latin1');tiff.writeUInt16LE(42,2);tiff.writeUInt32LE(8,4);
  tiff.writeUInt16LE(1,8);tiff.writeUInt16LE(0x8769,10);tiff.writeUInt16LE(4,12);tiff.writeUInt32LE(1,14);tiff.writeUInt32LE(26,18);tiff.writeUInt32LE(0,22);
  const entries=offset?2:1;tiff.writeUInt16LE(entries,26);
  tiff.writeUInt16LE(0x9003,28);tiff.writeUInt16LE(2,30);tiff.writeUInt32LE(20,32);tiff.writeUInt32LE(60,36);
  if(offset){tiff.writeUInt16LE(0x9011,40);tiff.writeUInt16LE(2,42);tiff.writeUInt32LE(7,44);tiff.writeUInt32LE(84,48);}
  tiff.write(date+'\0',60,'latin1');if(offset)tiff.write(offset+'\0',84,'latin1');
  return new Uint8Array(Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe1,0,0]),Buffer.from('Exif\0\0','latin1'),tiff]));
}

test('a library photo keeps the date it was taken from EXIF DateTimeOriginal',()=>{
  assert.equal(Location.parseCaptureTime(exifWithDate('2025:06:14 09:30:05','-05:00')),'2025-06-14T14:30:05.000Z');
  assert.equal(Location.parseCaptureTime(exifWithDate('2025:06:14 09:30:05','+02:00')),'2025-06-14T07:30:05.000Z');
  assert.equal(Location.parseCaptureTime(exifWithDate('2025:06:14 09:30:05')),new Date(2025,5,14,9,30,5).toISOString(),'no offset reads as device local time');
  assert.equal(Location.parseCaptureTime(exifWithDate('0000:00:00 00:00:00')),null,'blank camera dates are ignored');
  assert.equal(Location.parseCaptureTime(new Uint8Array(40)),null);
  assert.equal(Location.parse(exifWithDate('2025:06:14 09:30:05')),null,'GPS parsing is unchanged when no GPS is stored');
  // Capture sends the EXIF date only for library photos; camera photos keep the save time.
  assert.match(app,/state\._photoTakenAt=source==='library'&&window\.PhotoNotesPhotoLocation\?\.readCaptureTime/);
  assert.match(app,/captured_at:takenAt\|\|new Date\(\)\.toISOString\(\)/);
});

test('document header, footer and company name replace account branding only when set',()=>{
  const ctx={};vm.createContext(ctx);vm.runInContext(slice(server,'function documentBranding(','function unlinkOwnedAsset'),ctx);
  const account={company_name:'Account Co',header_text:'Account header',footer_text:'Account footer'};
  assert.deepEqual({...ctx.documentBranding(account,{company_name:'Doc Co',header_text:'  ',footer_text:'Doc footer'})},{company_name:'Doc Co',header_text:'Account header',footer_text:'Doc footer'});
  assert.deepEqual({...ctx.documentBranding(account,{})},account);
  assert.match(server,/if\(groupId\)branding=documentBranding\(branding,layout\);/);
  assert.match(app,/b=effectiveDocumentBranding\(window\.PhotoNotesExportPresets\?\.previewBranding\(\)\|\|currentDocumentSettings\.branding\|\|\{\},l\)/,'the preview matches the download');
});

test('copyright markings name the customer company or user, never Zukor AI',()=>{
  const ctx={};vm.createContext(ctx);vm.runInContext(slice(server,'function copyrightText(','async function copyrightNameForUser'),ctx);
  const year=new Date().getFullYear();
  assert.equal(ctx.copyrightText('Acme Roofing'),`© ${year} Acme Roofing. All Rights Reserved.`);
  assert.equal(ctx.copyrightText(''),`© ${year}. All Rights Reserved.`);
  const overlay=slice(server,'function overlayItemText(','// Burn overlays');
  assert.doesNotMatch(overlay,/Zukor AI/);
  const editor=slice(app,'// ================= Photo overlays / stamps editor','function drawOverlayItems');
  assert.doesNotMatch(editor,/Zukor AI/);
  // The app's own footer keeps its notice.
  assert.equal((app.match(/&copy; \$\{new Date\(\)\.getFullYear\(\)\} Zukor AI\. All Rights Reserved\./g)||[]).length,2);
});

test('urgent captures print Urgency: Urgent in PDF and Word details',()=>{
  const ctx={require,fmtDefect:()=>'',exportDims:()=>'',fmtWhen:()=>'10/1/2026'};vm.createContext(ctx);
  vm.runInContext(slice(server,'function documentPhotoDetails(','\n}\n')+'\n}',ctx);
  assert.ok(ctx.documentPhotoDetails({urgency:'urgent',area_tags:['Roof'],created_at:'2026-10-01'},true).includes('Urgency: Urgent'));
  assert.ok(!ctx.documentPhotoDetails({urgency:'standard',created_at:'2026-10-01'},true).some(line=>/Urgency/.test(line)));
});

test('a failed download navigation answers 204 and marks the failure instead of showing raw JSON',async()=>{
  const express=require('express'),web=express();
  const middleware=slice(server,"app.use('/api/export',(req,res,next)=>{","\n});")+'\n});';
  new Function('app',middleware)(web);
  web.get('/api/export/pdf',(req,res)=>res.status(500).json({error:'pdf export failed'}));
  web.get('/api/export/docx',(req,res)=>res.json({ok:true}));
  const listener=web.listen(0,'127.0.0.1');await new Promise(r=>listener.once('listening',r));
  const get=(path,headers)=>new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port:listener.address().port,path,headers},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,cookie:res.headers['set-cookie'],body}));}).on('error',reject));
  try{
    const navigated=await get('/api/export/pdf',{'Sec-Fetch-Mode':'navigate'});
    assert.equal(navigated.status,204);assert.equal(navigated.body,'');assert.match(String(navigated.cookie),/pn_download_failed=1; Max-Age=60/);
    const fetched=await get('/api/export/pdf',{'Sec-Fetch-Mode':'cors'});
    assert.equal(fetched.status,500,'fetch requests still receive the error');assert.match(fetched.body,/pdf export failed/);
    assert.equal((await get('/api/export/docx',{'Sec-Fetch-Mode':'navigate'})).status,200,'successful downloads are unchanged');
  }finally{listener.close();}
  assert.match(app,/window\.location\.assign\(exportDownloadUrl\(format, groupId\)\);\n\s*watchDownloadFailure\(\);/);
});

test('Send/Share caption never sends address instructions as the address',()=>{
  const els={addr:{textContent:"Enter the address if needed. The phone's current location is not used for a photo from the library."},gps:{textContent:'This photo has no saved location.'},note:{value:'Cracked step'}};
  const make=state=>{const ctx={window:{},document:{getElementById:id=>els[id]||null,querySelectorAll:()=>[]},Date,Number,String,Array,Object,RegExp};if(state)ctx.state=state;vm.createContext(ctx);vm.runInContext(slice(send,'  function q(id)','  function toast(m)')+';this.caption=caption;',ctx);return ctx.caption();};
  const withState=make({address:null,location:null});
  assert.doesNotMatch(withState,/Address|Enter the address/);assert.match(withState,/Notes: Cracked step/);
  assert.doesNotMatch(make(null),/Address/,'the placeholder is filtered without app state too');
  assert.match(make({address:'12 Main St, Austin, TX 78701',location:null}),/Address: 12 Main St/);
});

test('project filters in Create and Send use every project membership, as Library does',()=>{
  const ctx={uiT:t=>t};vm.createContext(ctx);vm.runInContext(slice(app,'function captureProjects(c){','function fillSendPhotoFilters'),ctx);
  const projects=ctx.captureProjects({job_id:7,job_name:'North',project_memberships:[{id:7,name:'North'},{id:8,name:'South',job_number:'S-1'}]});
  assert.equal(JSON.stringify([...projects]),JSON.stringify([['7','North'],['8','S-1 - South']]));
  assert.equal(ctx.captureProjects({job_id:null}).size,0);
  assert.match(app,/\(!job\|\|captureProjects\(c\)\.has\(job\)\)/);
  assert.match(app,/\(!newDocumentPhotoJob\|\|captureProjects\(p\)\.has\(newDocumentPhotoJob\)\)/);
});

test('documents can add photos and be deleted with a second tap, without browser dialogs',()=>{
  assert.equal((app.match(/async function deleteGroup\(/g)||[]).length,1,'one Delete Document function');
  const del=slice(app,'async function deleteGroup(','\n');
  assert.doesNotMatch(del,/confirm\(/);assert.match(del,/hoaArmed\(button,'Tap Again to Delete Document'\)/);
  assert.match(app,/id="gaddphotos"[^>]*>Add Photos<\/button>/);assert.match(app,/id="gdelete"[^>]*>Delete Document<\/button>/);
  assert.match(app,/api\(`\/api\/groups\/\$\{id\}\/add`/);
  assert.doesNotMatch(app,/Add Selected to a Document/);assert.doesNotMatch(app,/Untitled group/);
});

test('Library photo detail refreshes in place and Edit Note no longer needs the old Edit filter',()=>{
  const load=slice(app,'async function loadCards(','\n}\n');
  assert.match(load.split('\n').slice(0,4).join('\n'),/libraryPhotoOpen\(\)\)return renderLibraryPhoto\(true\)/);
  const note=slice(app,'function startEditNote(','\n}\n');
  assert.doesNotMatch(note,/getElementById\('filter'\)\.value/);
});

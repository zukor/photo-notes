const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(failure) {
  let activation=true, calls=0, modal=null, removed=false;
  const nodes={}; for(const key of ['[data-share-open]','[data-share-status]','[data-share-close]','[data-share-download]']) nodes[key]={focus(){},disabled:false};
  const document={activeElement:{focus(){}},body:{appendChild(el){modal=el;}},getElementById(){return null;},createElement(){return{querySelector:s=>nodes[s],querySelectorAll:()=>Object.values(nodes),remove(){removed=true;}};}};
  const c={document,window:{},uiT:s=>s,toast(){},safeSharedFileName:()=> 'fixture.docx',File:class {constructor(parts,name,opts){this.name=name;this.type=opts.type;}},exportBlob:async()=>{activation=false;return{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};},navigator:{canShare:()=>true,share:async()=>{calls++;if(!activation)throw Object.assign(new Error('Permission denied'),{name:'NotAllowedError'});if(failure)throw Object.assign(new Error(failure),{name:failure});}},downloadBlob(){}};
  const src=fs.readFileSync(process.env.APP_SOURCE||'public/app.js','utf8');
  const start=src.includes('function openPreparedExportShare')?src.indexOf('function openPreparedExportShare'):src.indexOf('async function deliverExport');
  vm.runInNewContext(src.slice(start,src.indexOf('async function shareSelectedPhotos')),c);
  return{c,nodes,get modal(){return modal;},get calls(){return calls;},get removed(){return removed;},tap(){activation=true;return nodes['[data-share-open]'].onclick();}};
}
test('slow document preparation waits for a new tap before native file sharing',async()=>{
  const f=fixture();await f.c.deliverExport('docx',42,'share');
  assert.equal(f.calls,0,'must not invoke native share after the preparation await');assert.ok(f.modal);
  await f.tap();assert.equal(f.calls,1);assert.equal(f.removed,true);
});
test('native sharing cancellation or denial keeps a retry and download path',async()=>{
  for(const reason of ['AbortError','NotAllowedError']) {
    const f=fixture(reason);await f.c.deliverExport('docx',42,'share');await f.tap();
    assert.equal(f.removed,false);assert.equal(f.nodes['[data-share-open]'].disabled,false);
    assert.match(f.nodes['[data-share-status]'].textContent,reason==='AbortError'?/canceled/:/Use Download/);
  }
});

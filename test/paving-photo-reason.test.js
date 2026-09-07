const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('public/app.js','utf8');
function fn(name,next){return app.slice(app.indexOf('async function '+name+'('),app.indexOf(next,app.indexOf('async function '+name+'(')));}
function scanner(kind,api){
 const reader=kind==='reader',id=reader?'readerRead':'ticketRead',elements={},state={};
 for(const key of [id,reader?'readerStatus':'ticketScanStatus'])elements[key]={disabled:false,hidden:true};
 const ctx={FormData,Blob,document:{getElementById:x=>elements[x]},api,setPavingToolBusy:()=>{},toast:()=>{},renderCameraReaderReview:()=>state.review=true,renderTicketReview:()=>state.review=true};vm.createContext(ctx);
 vm.runInContext(reader?"let cameraReaderFile=new Blob(['photo']),cameraReaderType='business_card',cameraReaderDraft=null;const readerConfigs={business_card:{noun:'business card'}};":"let ticketPhotoFile=new Blob(['photo']),ticketDraft=null;",ctx);
 vm.runInContext(reader?fn('scanCameraReader','function renderCameraReaderReview'):fn('scanTicketPhoto','function ticketField'),ctx);
 return {ctx,elements,state,id,scan:()=>reader?ctx.scanCameraReader():ctx.scanTicketPhoto()};
}
test('Paving reasons start with proposal and obey feature permissions',()=>{
 const context={state:{_pavingReason:'business_card'},featureOn:()=>false};vm.createContext(context);vm.runInContext(app.slice(app.indexOf('const PAVING_PHOTO_REASONS='),app.indexOf('function pavingPhotoReasonMarkup')),context);
 assert.deepEqual(Array.from(context.pavingPhotoReasons(),r=>r.id),['proposal']);assert.equal(context.pavingPhotoReason().id,'proposal');
 context.featureOn=()=>true;assert.equal(context.pavingPhotoReasons().length,8);assert.equal(context.pavingPhotoReasons()[0].label,'Proposal Photo');
});
for(const kind of ['reader','ticket']){
 test(kind+' scans once and displays the returned review',async()=>{let calls=0,resolve;const waiting=new Promise(r=>resolve=r);const s=scanner(kind,async()=>{calls++;await waiting;return {ok:true,json:async()=>({ai_read:true,reading:{id:5},ticket:{id:6}})};});const pending=s.scan();await s.scan();assert.equal(calls,1);resolve();await pending;assert.equal(s.state.review,true);});
 test(kind+' ignores a response after leaving its capture controls',async()=>{let resolve;const waiting=new Promise(r=>resolve=r);const s=scanner(kind,async()=>{await waiting;return {ok:true,json:async()=>({reading:{id:5},ticket:{id:6}})};});const pending=s.scan();s.elements[s.id]={disabled:false};resolve();await pending;assert.equal(s.state.review,undefined);assert.equal(s.elements[s.id].disabled,false);});
 test(kind+' exposes retry when automatic scanning fails',async()=>{const s=scanner(kind,async()=>{throw new Error('offline')});await s.scan();assert.equal(s.elements[s.id].disabled,false);assert.equal(s.elements[s.id].hidden,false);});
}
test('offline upload preserves the proposal reason',()=>{const context={FormData};vm.createContext(context);vm.runInContext(app.split('\n').find(x=>x.startsWith('function payloadFormData(')),context);assert.equal(context.payloadFormData({paving_photo_reason:'proposal'}).get('paving_photo_reason'),'proposal');});

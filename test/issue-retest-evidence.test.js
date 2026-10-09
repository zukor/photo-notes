const test=require('node:test'),assert=require('node:assert/strict');
const {registerRetest}=require('../issue-retest');
test('retest keeps the complete bounded diagnostic JSON in report and history',async()=>{
 let handler,stored,history;
 const client={query:async(sql,args)=>{
  if(sql.startsWith('SELECT *'))return {rows:[{management_status:'ready_to_test',verification:'checked',release_reference:'release',issue_type:'bug_problem'}]};
  if(sql.startsWith('SELECT count'))return {rows:[{n:2}]};
  if(sql.startsWith('UPDATE issue_reports'))stored=args[2];
  if(sql.includes("'retest',$2"))history=JSON.parse(args[1]).notes;
  return {rows:[]};
 },release(){}};
 registerRetest({post:(path,auth,fn)=>handler=fn},{pool:{connect:async()=>client},requireAuth(){},ticketText:(v,max)=>String(v||'').trim().slice(0,max),logEvent(){}});
 const diagnostics=Array.from({length:20},()=>({at:new Date().toISOString(),version:413,event:'audio-start',generation:20,active:true,pending:false,finishing:false,mode:'browser'}));
 const notes='Second recording failed\n\nSpeech event diagnostics (no note text or audio):\n'+JSON.stringify(diagnostics);
 assert(notes.length>2000&&notes.length<5000);
 let response;const res={status(n){assert.fail('Unexpected status '+n)},json(v){response=v}};
 await handler({params:{id:'176'},user:{id:1},body:{result:'still_happening',notes}},res);
 assert.equal(stored,notes);assert.equal(history,notes);assert.deepEqual(JSON.parse(stored.slice(stored.indexOf('[{'))),diagnostics);assert.equal(response.status,'blocked');
});

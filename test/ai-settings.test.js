const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createAISettings,estimate,rank}=require('../ai-settings');
const {createVisionReader}=require('../vision');
const image=()=>({rotate(){return this;},resize(){return this;},jpeg(){return this;},async toBuffer(){return Buffer.from('image');}});
test('cost calculation counts reported image/reasoning tokens and cache discounts; unknown never becomes zero',()=>{
 assert.equal(estimate('gpt-6-astra',{input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:500}},'openai'),.0105);
 assert.equal(estimate('claude-sonnet-4-6',{input_tokens:1000,output_tokens:100,cache_read_input_tokens:500},'anthropic'),.00465);
 assert.equal(estimate('unknown-model',{input_tokens:1000,output_tokens:100},'openai'),null);
 assert.equal(estimate('gpt-6-astra',null,'openai'),null);
 assert.equal(estimate('grok-4.7',{input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:10}},'grok'),null);
 assert.ok(rank('gpt-4.1')>rank('gpt-4.1-mini'));assert.ok(rank('gpt-6-astra')>rank('gpt-6.1-sol'));
});
test('all three adapters preserve photo input and record charged malformed replies using the in-flight selection',async()=>{
 for(const provider of ['anthropic','openai','grok']){
 const model=provider==='anthropic'?'claude-sonnet-4-6':provider==='openai'?'gpt-6-astra':'grok-4.7';let sent,ledger=[];
 const reader=createVisionReader({env:{ANTHROPIC_API_KEY:'secret',OPENAI_API_KEY:'secret',XAI_API_KEY:'secret'},image,settings:{selection:async()=>({provider,model}),begin:async s=>{ledger.push(s);return 1;},record:async(...a)=>ledger.push(a)},fetcher:async(url,opts)=>{sent={url,body:JSON.parse(opts.body)};return {ok:true,json:async()=>({model,usage:{input_tokens:10,output_tokens:5},content:[{type:'text',text:'invalid'}],output:[{type:'message',content:[{type:'output_text',text:'invalid'}]}]})};}});
 assert.equal((await reader('photo','prompt')).error,'invalid_response');assert.equal(ledger.length,2);assert.equal(ledger[1][1].model,model);assert.equal(sent.body.model,model);assert.match(JSON.stringify(sent.body),provider==='anthropic'?/image\/jpeg/:/data:image\/jpeg/);
 }
});
test('ledger reservation failure prevents an untracked billable request',async()=>{
 let called=false;const r=createVisionReader({env:{ANTHROPIC_API_KEY:'secret'},image,settings:{selection:async()=>({provider:'anthropic',model:'claude-sonnet-4-6'}),begin:async()=>{throw Error('DB unavailable');}},fetcher:async()=>{called=true;}});
 assert.equal((await r('photo','prompt')).error,'unavailable');assert.equal(called,false);
});
test('model catalog paginates Anthropic, sorts capability, and flags incompatible OpenAI models',async()=>{
 let calls=0;const s=createAISettings({pool:{},env:{ANTHROPIC_API_KEY:'secret',OPENAI_API_KEY:'secret'},fetcher:async url=>({ok:true,json:async()=>url.includes('anthropic')?++calls===1?{data:[{id:'claude-haiku-5-5'}],has_more:true,last_id:'first'}:{data:[{id:'claude-opus-5-5'}],has_more:false}:{data:[{id:'whisper-1'},{id:'gpt-6-astra'}]}})});
 const c=await s.catalog('anthropic');assert.equal(c.models[0].id,'claude-opus-5-5');assert.equal(calls,2);
 const o=await s.catalog('openai');assert.equal(o.models.find(m=>m.id==='whisper-1').compatible,false);
 await assert.rejects(s.catalog('other'));
});
test('AI settings and usage reject regular admins and regular view, including direct writes',async()=>{
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:1,role:req.get('test-role')||'admin'};next();});let writes=0;
 const s=createAISettings({pool:{query:async()=>{writes++;return {rows:[{provider:'anthropic',model:'claude-sonnet-4-6'}]};}},env:{SUPER_ADMIN_USER_IDS:'1'}});s.register(app,(req,res,next)=>next());
 const server=app.listen(0);await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{for(const path of ['/api/admin/ai','/api/admin/ai/models?provider=openai','/api/admin/ai/usage']){assert.equal((await fetch(base+path,{headers:{'test-role':'user'}})).status,403);assert.equal((await fetch(base+path,{headers:{'X-Photo-Notes-Admin-View':'regular'}})).status,403);}assert.equal((await fetch(base+'/api/admin/ai',{method:'PUT',headers:{'X-Photo-Notes-Admin-View':'regular','Content-Type':'application/json'},body:'{"provider":"openai","model":"gpt-6-astra"}'})).status,403);assert.equal(writes,0);assert.equal((await fetch(base+'/api/admin/ai')).status,200);}finally{await new Promise(r=>server.close(r));}
});

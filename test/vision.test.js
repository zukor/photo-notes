const test=require('node:test'),assert=require('node:assert/strict');
const {createVisionReader,parseJSONLoose}=require('../vision');
const image=()=>({rotate(){return this;},resize(){return this;},jpeg(){return this;},async toBuffer(){return Buffer.from('synthetic-image');}});
const env={ANTHROPIC_API_KEY:'test-only-key'};
const response=data=>({ok:true,json:async()=>({content:[{type:'text',text:JSON.stringify(data)}]})});
test('unconfigured scanning makes no provider call and identifies setup failure',async()=>{
 const reader=createVisionReader({env:{},fetcher:()=>{throw Error('must not call');}});
 const r=await reader('/fixture','prompt');assert.equal(r.error,'not_configured');assert.equal(r.data,null);assert.match(r.message,/not set up/);
 assert.equal(reader.status().configured,false);
});
test('vision request retains image, uses model and parses text blocks without leaking secrets',async()=>{
 let sent;const reader=createVisionReader({env,image,fetcher:async(url,opts)=>{
  sent={url,opts};return {ok:true,json:async()=>({content:[{type:'thinking',thinking:'ignored'},{type:'text',text:'```json\n{"ticket_number":"00042","net_tons":0}\n```'}]})};
 }});
 const r=await reader('/fixture','Extract visible values',{maxTokens:1200});
 assert.deepEqual(r.data,{ticket_number:'00042',net_tons:0});assert.equal(r.error,null);
 assert.equal(sent.url,'https://api.anthropic.com/v1/messages');assert.ok(sent.opts.signal);
 const body=JSON.parse(sent.opts.body);assert.equal(body.model,'claude-sonnet-4-6');assert.equal(body.max_tokens,1200);
 assert.equal(body.messages[0].content[0].source.media_type,'image/jpeg');
 assert.equal(JSON.stringify(reader.status()).includes('test-only-key'),false);
});
test('provider authentication, billing, limits and outages remain distinct from unreadable photos',async()=>{
 for(const [status,error,message] of [[401,'authentication'],[403,'authentication'],[402,'billing'],[400,'billing','Your credit balance is too low'],[429,'rate_limit'],[529,'unavailable'],[500,'unavailable'],[400,'unavailable','invalid model']]){
  const reader=createVisionReader({env,image,fetcher:async()=>({ok:false,status,json:async()=>({error:{message}})})});
  const r=await reader('/fixture','prompt');assert.equal(r.error,error);assert.equal(r.data,null);assert.doesNotMatch(r.message,/test-only-key|invalid model|retake/i);
 }
});
test('empty, null, malformed and truncated results are not reported as successful reads',async()=>{
 for(const data of [{},{confidence:'low'},{ticket_number:null,confidence:'low'},[],null]){
  const reader=createVisionReader({env,image,fetcher:async()=>response(data)});
  const r=await reader('/fixture','prompt');assert.equal(r.data,null);assert.ok(['unreadable','invalid_response'].includes(r.error));
 }
 const reader=createVisionReader({env,image,fetcher:async()=>({ok:true,json:async()=>({stop_reason:'max_tokens',content:[{type:'text',text:'{"ticket_number":"42"}'}]})})});
 assert.equal((await reader('/fixture','prompt')).error,'invalid_response');
 assert.equal(parseJSONLoose('[1,2]'),null);
});
test('timeout and invalid photos allow a retry without blaming photo quality for network failure',async()=>{
 const reader=createVisionReader({env,image,timeoutMs:5,fetcher:async(url,{signal})=>new Promise((resolve,reject)=>{
  const keepAlive=setTimeout(resolve,100);
  signal.addEventListener('abort',()=>{clearTimeout(keepAlive);reject(signal.reason);});
 })});
 assert.equal((await reader('/fixture','prompt')).error,'timeout');
 const invalid=createVisionReader({env,image:()=>{throw Error('bad image');}});
 assert.equal((await invalid('/fixture','prompt')).error,'invalid_image');
});

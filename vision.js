const sharp = require('sharp');
const {PROVIDERS,headers,configured}=require('./ai-settings');
const VISION_MODEL = process.env.VISION_MODEL || 'claude-sonnet-4-6';
const MESSAGES = {
  not_configured: 'Automatic scanning is not set up yet. Your photo is available for manual entry.',
  authentication: 'Automatic scanning is unavailable because the service connection needs attention. Your photo is available for manual entry.',
  billing: 'Automatic scanning is unavailable because the service account needs attention. Your photo is available for manual entry.',
  rate_limit: 'Automatic scanning is busy or has reached its usage limit. Try again later, or enter the details manually.',
  timeout: 'Automatic scanning took too long. Try again, or enter the details manually.',
  unavailable: 'The automatic scanning service is temporarily unavailable. Try again later, or enter the details manually.',
  invalid_response: 'The scanning service returned an incomplete result. Try again, or enter the details manually.',
  unreadable: 'No readable details were found in this photo. Try a clearer photo, or enter the details manually.',
  invalid_image: 'This photo could not be opened. Choose another image, or enter the details manually.',
};
function parseJSONLoose(text) {
  if (typeof text !== 'string') return null;
  let t = text.trim().replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/i, '').trim();
  if(t[0] !== '{') {const match=t.match(/\{[\s\S]*\}/);if(match)t=match[0];}
  try {
    const data=JSON.parse(t);
    return data && typeof data==='object' && !Array.isArray(data) ? data : null;
  } catch {return null;}
}
function createVisionReader({env=process.env,fetcher=(...args)=>fetch(...args),image=sharp,timeoutMs=45000,settings=null}={}) {
  let lastResult=null,lastSelection={provider:'anthropic',model:env.VISION_MODEL||VISION_MODEL};
  const finish=(data,error=null)=>{
    lastResult={status:error||'ok',checked_at:new Date().toISOString()};
    return {data,error,message:error?MESSAGES[error]:null};
  };
  const read=async(localPath,prompt,opts={})=>{
    let selected;
    try{selected=settings?await settings.selection():{provider:'anthropic',model:env.VISION_MODEL||VISION_MODEL};}catch{return finish(null,'unavailable');}
    lastSelection=selected;
    if(!Object.hasOwn(PROVIDERS,selected.provider)||!configured(selected.provider,env))return finish(null,'not_configured');
    let jpeg;
    try {
      jpeg=await image(localPath).rotate().resize({width:1568,height:1568,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
    } catch {return finish(null,'invalid_image');}
    const signal=AbortSignal.timeout(timeoutMs);
    let usageId=null,recorded=false;
    const log=async(body,status)=>{if(settings&&usageId){await settings.record(usageId,selected,body,status);recorded=true;}};
    try {
      // Reserve a durable ledger entry before incurring a provider charge.
      if(settings)usageId=await settings.begin(selected);
      const anthropic=selected.provider==='anthropic';
      const maxTokens=opts.maxTokens||1000;
      const request=anthropic?{model:selected.model,max_tokens:Math.max(maxTokens,/claude-(fable|mythos)|claude-.*-5/.test(selected.model)?8192:0),messages:[{role:'user',content:[
        {type:'image',source:{type:'base64',media_type:'image/jpeg',data:jpeg.toString('base64')}},
        {type:'text',text:prompt}]}]}:{model:selected.model,max_output_tokens:Math.max(maxTokens,8192),store:false,input:[{role:'user',content:[
        {type:'input_image',image_url:'data:image/jpeg;base64,'+jpeg.toString('base64')},
        {type:'input_text',text:prompt}]}]};
      const response=await fetcher(PROVIDERS[selected.provider].base+(anthropic?'/messages':'/responses'),{
        method:'POST',signal,headers:{'content-type':'application/json',...headers(selected.provider,env)},body:JSON.stringify(request),
      });
      if(!response.ok){
        await log(null,'failed');
        if([401,403].includes(response.status))return finish(null,'authentication');
        if(response.status===402)return finish(null,'billing');
        if(response.status===429)return finish(null,'rate_limit');
        if(response.status===400){
          const body=await response.json().catch(()=>({}));
          // Classify known billing errors without exposing provider text or secrets.
          if(/credit balance|billing|spend limit|usage limits/i.test(String(body.error?.message||'')))return finish(null,'billing');
        }
        return finish(null,'unavailable');
      }
      const body=await response.json();
      await log(body,body.status==='failed'?'failed':'received');
      if(body.status==='failed')return finish(null,'unavailable');
      if(body.status==='incomplete')return finish(null,'invalid_response');
      if(body.stop_reason==='max_tokens')return finish(null,'invalid_response');
      const blocks=anthropic?(body.content||[]):(body.output||[]).filter(item=>item.type==='message').flatMap(item=>item.content||[]);
      const text=blocks.filter(block=>['text','output_text'].includes(block.type)).map(block=>block.text).join('\n');
      const data=parseJSONLoose(text);
      if(!data)return finish(null,'invalid_response');
      const meaningful=Object.entries(data).some(([k,v])=>!['confidence','warning','rationale'].includes(k)&&v!=null&&String(v).trim()!=='');
      const result=meaningful?finish(data):finish(null,'unreadable');return {...result,provider:selected.provider,model:body.model||selected.model};
    } catch {if(!recorded)try{await log(null,'failed');}catch{console.error('[ai] Usage ledger update failed; pending entry retained');}return finish(null,signal.aborted?'timeout':'unavailable');}
  };
  read.status=()=>({configured:configured(lastSelection.provider,env),provider:lastSelection.provider,model:lastSelection.model,last_result:lastResult});
  read.useSettings=value=>{settings=value;};
  return read;
}
const visionJSON=createVisionReader();
function visionFeedback(result) {return {ai_error:result.error,ai_message:result.message};}
module.exports={VISION_MODEL,visionJSON,visionFeedback,createVisionReader,parseJSONLoose,MESSAGES};

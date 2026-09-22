const sharp = require('sharp');
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
function createVisionReader({env=process.env,fetcher=(...args)=>fetch(...args),image=sharp,timeoutMs=45000}={}) {
  let lastResult=null;
  const finish=(data,error=null)=>{
    lastResult={status:error||'ok',checked_at:new Date().toISOString()};
    return {data,error,message:error?MESSAGES[error]:null};
  };
  const read=async(localPath,prompt,opts={})=>{
    const key=String(env.ANTHROPIC_API_KEY||'').trim();
    if(!key)return finish(null,'not_configured');
    let jpeg;
    try {
      jpeg=await image(localPath).rotate().resize({width:1568,height:1568,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
    } catch {return finish(null,'invalid_image');}
    const signal=AbortSignal.timeout(timeoutMs);
    try {
      const response=await fetcher('https://api.anthropic.com/v1/messages',{
        method:'POST',signal,
        headers:{'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},
        body:JSON.stringify({model:env.VISION_MODEL||VISION_MODEL,max_tokens:opts.maxTokens||1000,
          messages:[{role:'user',content:[
            {type:'image',source:{type:'base64',media_type:'image/jpeg',data:jpeg.toString('base64')}},
            {type:'text',text:prompt},
          ]}]}),
      });
      if(!response.ok){
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
      if(body.stop_reason==='max_tokens')return finish(null,'invalid_response');
      const text=(body.content||[]).filter(block=>block.type==='text').map(block=>block.text).join('\n');
      const data=parseJSONLoose(text);
      if(!data)return finish(null,'invalid_response');
      const meaningful=Object.entries(data).some(([k,v])=>!['confidence','warning','rationale'].includes(k)&&v!=null&&String(v).trim()!=='');
      return meaningful?finish(data):finish(null,'unreadable');
    } catch {return finish(null,signal.aborted?'timeout':'unavailable');}
  };
  read.status=()=>({configured:!!String(env.ANTHROPIC_API_KEY||'').trim(),model:env.VISION_MODEL||VISION_MODEL,last_result:lastResult});
  return read;
}
const visionJSON=createVisionReader();
function visionFeedback(result) {return {ai_error:result.error,ai_message:result.message};}
module.exports={VISION_MODEL,visionJSON,visionFeedback,createVisionReader,parseJSONLoose,MESSAGES};

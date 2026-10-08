const {isSuperAdmin}=require('./super-admin');
const PROVIDERS={openai:{name:'OpenAI',key:'OPENAI_API_KEY',base:'https://api.openai.com/v1'},anthropic:{name:'Anthropic',key:'ANTHROPIC_API_KEY',base:'https://api.anthropic.com/v1'},grok:{name:'Grok',key:'XAI_API_KEY',base:'https://api.x.ai/v1'}};
const SCHEMA=`CREATE TABLE IF NOT EXISTS ai_settings(id integer PRIMARY KEY CHECK(id=1),provider text NOT NULL,model text NOT NULL,updated_by integer,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS ai_usage(id bigserial PRIMARY KEY,started_at timestamptz NOT NULL DEFAULT now(),provider text NOT NULL,model text NOT NULL,status text NOT NULL DEFAULT 'pending',input_tokens bigint,output_tokens bigint,cached_tokens bigint,estimated_usd numeric(18,10),pricing_version text);
CREATE INDEX IF NOT EXISTS ai_usage_started_idx ON ai_usage(started_at);
CREATE TABLE IF NOT EXISTS ai_settings_history(id bigserial PRIMARY KEY,actor_id integer NOT NULL,provider text NOT NULL,model text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());`;
// Standard USD per million tokens, verified 2026-10-08. Unknown rates stay unknown.
// Sources: developers.openai.com/api/docs/pricing, platform.claude.com/docs/en/about-claude/pricing, docs.x.ai/developers/models
const RATES={
 'gpt-6-astra':[10,50,1], 'gpt-6.1-sol':[2,10,.1], 'gpt-6-luna':[.1,.5,.01],
 'claude-fable-5-1':[10,50,.25], 'claude-mythos-5-1':[10,50,.25], 'claude-opus-5-5':[4,20,.2], 'claude-sonnet-5-5':[2,10,.1], 'claude-haiku-5-5':[.1,.5,.01],
 'claude-sonnet-5':[2,10,.2], 'claude-sonnet-4-5':[3,15,.3], 'claude-sonnet-4':[3,15,.3], 'claude-haiku-4-5':[1,5,.1], 'claude-opus-4-5':[5,25,.5], 'claude-opus-4-1':[15,75,1.5], 'claude-opus-4':[15,75,1.5],
 'claude-fable-5':[10,50,1], 'claude-mythos-5':[10,50,1], 'claude-opus-5':[5,25,.5], 'claude-opus-4-8':[5,25,.5], 'claude-opus-4-7':[5,25,.5], 'claude-opus-4-6':[5,25,.5], 'claude-sonnet-4-6':[3,15,.3], 'grok-4.7':[2,6,null]
};
function rates(model){return RATES[model]||Object.entries(RATES).sort((a,b)=>b[0].length-a[0].length).find(([id])=>model.startsWith(id+'-20'))?.[1]||null;}
const ORDER=['gpt-6-astra','gpt-6.1-sol','gpt-6-sol','gpt-6-luna','gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','gpt-5.4-pro','gpt-5.4','gpt-5.2-pro','gpt-5.2','gpt-5.1','gpt-5','o3-pro','o3','o4-mini','gpt-4.1','gpt-4o','gpt-4.1-mini','gpt-4o-mini','gpt-4.1-nano'];
function rank(id){
 const match=ORDER.filter(x=>id===x||id.startsWith(x+'-')).sort((a,b)=>b.length-a.length)[0];if(match)return 1000-ORDER.indexOf(match);
 if(/^claude-/.test(id)){const tier=/fable|mythos/.test(id)?500:/opus/.test(id)?400:/sonnet/.test(id)?300:/haiku/.test(id)?200:0;const version=id.match(/(?:fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d+))?/);return tier+(version?Number(version[1])*10+Number(version[2]||0):0);}
 if(/^grok-/.test(id)){const known=['grok-4.7','grok-4.3','grok-4.20','grok-4.1','grok-4','grok-3','grok-2'];const family=known.find(x=>id===x||id.startsWith(x+'-'));if(family)return 1000-known.indexOf(family)*50-(/mini/.test(id)?30:0)-(/fast/.test(id)?10:0);const v=id.match(/grok-(\d+)(?:[.-](\d+))?/);return v?Number(v[1])*100+Number(v[2]||0)-(/mini/.test(id)?50:0)-(/fast/.test(id)?10:0):0;}
 return 0;
}
function compatible(provider,m){
 if(provider==='anthropic')return /^claude-/.test(m.id);
 if(provider==='grok')return m.input_modalities?.includes('image')&&m.output_modalities?.includes('text');
 return /^(gpt-(?:[56](?:\.|-)|4o(?:-|$)|4\.1(?:-|$)|4-turbo(?:-|$)|4-vision(?:-|$))|o[134](?:-|$))/.test(m.id)&&!/(audio|realtime|transcri|tts|search|deep-research|codex|chat-latest)/.test(m.id);
}
function headers(provider,env){const p=PROVIDERS[provider];return provider==='anthropic'?{'x-api-key':env[p.key],'anthropic-version':'2023-06-01'}:{authorization:`Bearer ${env[p.key]|| (provider==='grok'?env.GROK_API_KEY:'')}`};}
function configured(provider,env){return !!String(env[PROVIDERS[provider].key]||(provider==='grok'?env.GROK_API_KEY:'')||'').trim();}
function estimate(model,usage,provider){
 if(!usage)return null;
 const input=usage.input_tokens??usage.prompt_tokens,output=usage.output_tokens??usage.completion_tokens;
 const cached=usage.input_tokens_details?.cached_tokens??usage.prompt_tokens_details?.cached_tokens??usage.cache_read_input_tokens??0;
 const r=rates(model);if(!r||!Number.isFinite(input)||!Number.isFinite(output)||cached>input&&provider!=='anthropic'||cached&&r[2]==null||usage.cache_creation_input_tokens)return null;
 const normal=provider==='anthropic'?input:Math.max(0,input-cached);
 // Our photo prompts are bounded; never guess long-context pricing.
 if(input+cached>100000)return null;
 return (normal*r[0]+output*r[1]+cached*(r[2]||0))/1e6;
}
function createAISettings({pool,env=process.env,fetcher=(...a)=>fetch(...a)}){
 async function selection(){return (await pool.query('SELECT provider,model FROM ai_settings WHERE id=1')).rows[0]||{provider:'anthropic',model:env.VISION_MODEL||'claude-sonnet-4-6'};}
 async function catalog(provider){
 if(typeof provider!=='string'||!Object.hasOwn(PROVIDERS,provider))throw Object.assign(Error('Choose OpenAI, Anthropic or Grok'),{status:400});
 if(!configured(provider,env))return {provider,configured:false,models:[],message:`${PROVIDERS[provider].key} is not configured on the server.`};
 let list=[],after=null;
 do{const url=PROVIDERS[provider].base+(provider==='grok'?'/language-models':'/models')+(provider==='anthropic'?'?limit=100'+(after?'&after_id='+encodeURIComponent(after):''):'');
 const r=await fetcher(url,{headers:headers(provider,env),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Object.assign(Error('The company model list could not be loaded. Check server credentials and try again.'),{status:502});
 const body=await r.json();list.push(...(body.data||body.models||[]));const next=body.has_more?body.last_id:null;if(next&&next===after)throw Error('Invalid model pagination');after=next;
 }while(after);
 const models=[...new Map(list.filter(m=>typeof m.id==='string').map(m=>[m.id,{id:m.id,name:m.display_name||m.id,compatible:!!compatible(provider,m),rank:rank(m.id),rates:rates(m.id)}])).values()].sort((a,b)=>b.rank-a.rank||a.id.localeCompare(b.id));
 return {provider,configured:true,models,checked_at:new Date().toISOString(),message:'Approximate capability order. Unranked models appear last. Only photo-analysis models can be selected.'};
 }
 async function begin(s){return (await pool.query('INSERT INTO ai_usage(provider,model) VALUES($1,$2) RETURNING id',[s.provider,s.model])).rows[0].id;}
 async function record(id,s,body,status){const u=body?.usage;await pool.query('UPDATE ai_usage SET status=$2,input_tokens=$3,output_tokens=$4,cached_tokens=$5,estimated_usd=$6,pricing_version=$7 WHERE id=$1',[id,status,u?.input_tokens??u?.prompt_tokens??null,u?.output_tokens??u?.completion_tokens??null,u?.cache_read_input_tokens??u?.input_tokens_details?.cached_tokens??u?.prompt_tokens_details?.cached_tokens??null,estimate(s.model,u,s.provider),'2026-10-08-standard']);}
 function register(app,requireAdmin){
 const guard=(req,res,next)=>isSuperAdmin(req.user,env)&&req.get('X-Photo-Notes-Admin-View')!=='regular'?next():res.status(403).json({error:'Super Admin access required'});
 const wrap=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(e){res.status(e.status||503).json({error:e.status?e.message:'AI settings are temporarily unavailable'});}};
 app.get('/api/admin/ai',requireAdmin,guard,wrap(async(req,res)=>res.json({selection:await selection(),providers:Object.entries(PROVIDERS).map(([id,p])=>({id,name:p.name,configured:configured(id,env)}))})));
 app.get('/api/admin/ai/models',requireAdmin,guard,wrap(async(req,res)=>res.json(await catalog(String(req.query.provider||'')))));
 app.put('/api/admin/ai',requireAdmin,guard,wrap(async(req,res)=>{
 const {provider,model}=req.body||{};if(typeof model!=='string'||model.length>200)throw Object.assign(Error('Select a model'),{status:400});
 const c=await catalog(provider);if(!c.configured||!c.models.some(m=>m.id===model&&m.compatible))throw Object.assign(Error('Select an available photo-analysis model from the company list'),{status:400});
 const client=await pool.connect();try{await client.query('BEGIN');await client.query('INSERT INTO ai_settings(id,provider,model,updated_by) VALUES(1,$1,$2,$3) ON CONFLICT(id) DO UPDATE SET provider=$1,model=$2,updated_by=$3,updated_at=now()',[provider,model,req.user.id]);await client.query('INSERT INTO ai_settings_history(actor_id,provider,model) VALUES($1,$2,$3)',[req.user.id,provider,model]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}res.json({selection:{provider,model}});
 }));
 app.get('/api/admin/ai/usage',requireAdmin,guard,wrap(async(req,res)=>{
 const rows=(await pool.query(`SELECT to_char(started_at AT TIME ZONE 'America/Chicago','YYYY-MM-DD') AS day,provider,model,count(*)::int AS requests,count(*) FILTER(WHERE status='failed')::int AS failures,count(*) FILTER(WHERE estimated_usd IS NULL)::int AS unknown_cost_requests,sum(input_tokens)::text AS input_tokens,sum(output_tokens)::text AS output_tokens,sum(estimated_usd)::text AS estimated_usd FROM ai_usage WHERE started_at>=now()-interval '30 days' GROUP BY day,provider,model ORDER BY day DESC,provider,model`)).rows;
 res.json({timezone:'America/Chicago',currency:'USD',days:rows,tracking_started:(await pool.query('SELECT min(started_at) AS at FROM ai_usage')).rows[0]?.at||null,note:'Estimated standard API charges for Photo Notes requests since tracking began. Unknown costs are excluded from totals. Provider invoices may differ.'});
 }));
 }
 return {selection,catalog,begin,record,register};
}
module.exports={SCHEMA,PROVIDERS,createAISettings,headers,configured,rank,compatible,estimate,rates};

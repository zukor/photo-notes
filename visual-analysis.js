const concrete=require('./concrete-analyzer');
const SCHEMA=`CREATE TABLE IF NOT EXISTS visual_analysis_runs (
 id BIGSERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 capture_id INTEGER NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
 domain TEXT NOT NULL, analyzer_version TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), raw_response JSONB NOT NULL,
 structured_result JSONB NOT NULL, confidence TEXT NOT NULL,
 review_status TEXT NOT NULL DEFAULT 'suggested' CHECK(review_status IN ('suggested','reviewed','corrected','rejected')),
 reviewed_result JSONB, reviewed_at TIMESTAMPTZ);
 CREATE INDEX IF NOT EXISTS visual_analysis_capture ON visual_analysis_runs(user_id,capture_id,created_at DESC);
 ALTER TABLE captures ADD COLUMN IF NOT EXISTS concrete_reviewed_observation TEXT;`;
function registerVisualAnalysis(app,dependencies){
 const {pool,requireAuth,requireConcrete,localPhoto,visionJSON}=dependencies;
 const domains=dependencies.domains||[{analyzer:concrete,authorize:requireConcrete}];
 for(const {analyzer:adapter,authorize} of domains){
 const domain=adapter.id,reviewFields=adapter.reviewFields;
 // Domain adapters own their schemas. The transport remains exclusively vision.js.
 const guards=[requireAuth,authorize];
 app.get(`/api/visual-analysis/${domain}/:id`,...guards,async(req,res)=>{try{
 const photo=(await pool.query('SELECT * FROM captures WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id])).rows[0];
 if(!photo)return res.status(404).json({error:'Photo not found'});
 const {rows}=await pool.query('SELECT * FROM visual_analysis_runs WHERE capture_id=$1 AND user_id=$2 AND domain=$3 ORDER BY created_at DESC,id DESC',[photo.id,req.user.id,domain]);res.json({photo,runs:rows,schema:adapter.schema});
 }catch{res.status(500).json({error:'Analysis history could not be loaded. Manual documentation remains available.'});}});
 app.post(`/api/visual-analysis/${domain}/:id`,...guards,async(req,res)=>{try{
 const photo=(await pool.query('SELECT * FROM captures WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id])).rows[0];
 if(!photo)return res.status(404).json({error:'Photo not found'});
 const local=localPhoto(photo.photo_path);if(!local)return res.status(400).json({error:'Choose a saved photo'});
 const ai=await visionJSON(local,adapter.prompt,{maxTokens:2200});
 if(!ai.data)return res.status(503).json({error:ai.message,ai_error:ai.error});
 let result;try{result=adapter.normalize(ai.data);}catch{return res.status(502).json({error:'Analysis returned invalid suggestions. Retry or continue manually.'});}
 const run=(await pool.query(`INSERT INTO visual_analysis_runs(user_id,capture_id,domain,analyzer_version,provider,model,raw_response,structured_result,confidence) SELECT $1,id,$3,$4,$5,$6,$7,$8,$9 FROM captures WHERE id=$2 AND user_id=$1 RETURNING *`,[req.user.id,photo.id,adapter.id,adapter.version,ai.provider||'anthropic',ai.model||visionJSON.status().model,JSON.stringify(ai.data),JSON.stringify(result),result.confidence])).rows[0];
 if(!run)return res.status(404).json({error:'Photo not found'});res.json(run);
 }catch{res.status(500).json({error:'Analysis could not be saved. Retry or continue manually.'});}});
 app.post(`/api/visual-analysis/${domain}/:id/review/:run`,...guards,async(req,res)=>{
 let result,apply=req.body.apply||[];const reject=req.body.reject===true;
 try{if(!reject)result=adapter.normalize(req.body.result,{review:true});if(!Array.isArray(apply)||apply.some(k=>!Object.hasOwn(reviewFields,k)))throw Error();}catch{return res.status(400).json({error:'Check the review fields'});}
 let client;try{client=await pool.connect();
 await client.query('BEGIN');
 const photo=(await client.query('SELECT * FROM captures WHERE id=$1 AND user_id=$2 FOR UPDATE',[req.params.id,req.user.id])).rows[0];
 const run=(await client.query("SELECT * FROM visual_analysis_runs WHERE id=$1 AND capture_id=$2 AND user_id=$3 AND domain=$4 FOR UPDATE",[req.params.run,req.params.id,req.user.id,domain])).rows[0];
 if(!photo||!run){await client.query('ROLLBACK');return res.status(404).json({error:'Analysis not found'});}
 if(run.review_status!=='suggested'){await client.query('ROLLBACK');return res.status(409).json({error:'This run has already been reviewed. Rerun for new suggestions.'});}
 if(!reject){
 for(const key of apply){if((photo[reviewFields[key]]||null)!==(req.body.existing?.[key]||null)){await client.query('ROLLBACK');return res.status(409).json({error:'Photo fields changed. Reopen review before applying.'});}}
 await adapter.applyReview(client,photo,req.user.id,result,apply);
 }
 const status=reject?'rejected':JSON.stringify(result)===JSON.stringify(run.structured_result)?'reviewed':'corrected';
 await client.query('UPDATE visual_analysis_runs SET review_status=$1,reviewed_result=$2,reviewed_at=now() WHERE id=$3 AND user_id=$4',[status,reject?null:JSON.stringify(result),run.id,req.user.id]);
 await client.query('COMMIT');res.json({ok:true,status});
 }catch{if(client)await client.query('ROLLBACK').catch(()=>{});res.status(500).json({error:'Review could not be saved. Your photo and manual fields remain available.'});}finally{client?.release();}
 });
 }
}
module.exports={SCHEMA,registerVisualAnalysis};

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
function registerVisualAnalysis(app,{pool,requireAuth,requireConcrete,localPhoto,visionJSON}){
 const adapters={concrete};
 // Domain adapters own their schemas. The transport remains exclusively vision.js.
 const guards=[requireAuth,requireConcrete];
 app.get('/api/visual-analysis/concrete/:id',...guards,async(req,res)=>{try{
 const photo=(await pool.query('SELECT id,photo_path,concrete_element,concrete_condition,concrete_severity FROM captures WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id])).rows[0];
 if(!photo)return res.status(404).json({error:'Photo not found'});
 const {rows}=await pool.query('SELECT * FROM visual_analysis_runs WHERE capture_id=$1 AND user_id=$2 AND domain=$3 ORDER BY created_at DESC,id DESC',[photo.id,req.user.id,'concrete']);res.json({photo,runs:rows,schema:{elements:concrete.elements,conditions:concrete.conditions,severities:concrete.severities,findingTypes:concrete.findingTypes}});
 }catch{res.status(500).json({error:'Analysis history could not be loaded. Manual documentation remains available.'});}});
 app.post('/api/visual-analysis/concrete/:id',...guards,async(req,res)=>{try{
 const photo=(await pool.query('SELECT * FROM captures WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id])).rows[0];
 if(!photo)return res.status(404).json({error:'Photo not found'});
 const local=localPhoto(photo.photo_path);if(!local)return res.status(400).json({error:'Choose a saved photo'});
 const adapter=adapters.concrete,ai=await visionJSON(local,adapter.prompt,{maxTokens:2200});
 if(!ai.data)return res.status(503).json({error:ai.message,ai_error:ai.error});
 let result;try{result=adapter.normalize(ai.data);}catch{return res.status(502).json({error:'Analysis returned invalid suggestions. Retry or continue manually.'});}
 const run=(await pool.query(`INSERT INTO visual_analysis_runs(user_id,capture_id,domain,analyzer_version,provider,model,raw_response,structured_result,confidence) SELECT $1,id,$3,$4,$5,$6,$7,$8,$9 FROM captures WHERE id=$2 AND user_id=$1 RETURNING *`,[req.user.id,photo.id,adapter.id,adapter.version,'anthropic',visionJSON.status().model,JSON.stringify(ai.data),JSON.stringify(result),result.confidence])).rows[0];
 if(!run)return res.status(404).json({error:'Photo not found'});res.json(run);
 }catch{res.status(500).json({error:'Analysis could not be saved. Retry or continue manually.'});}});
 app.post('/api/visual-analysis/concrete/:id/review/:run',...guards,async(req,res)=>{
 let result,apply=req.body.apply||[];const reject=req.body.reject===true;
 try{if(!reject)result=concrete.normalize(req.body.result,{review:true});if(!Array.isArray(apply)||apply.some(k=>!['element','condition','severity'].includes(k)))throw Error();}catch{return res.status(400).json({error:'Check the review fields'});}
 const client=await pool.connect();try{
 await client.query('BEGIN');
 const photo=(await client.query('SELECT * FROM captures WHERE id=$1 AND user_id=$2 FOR UPDATE',[req.params.id,req.user.id])).rows[0];
 const run=(await client.query("SELECT * FROM visual_analysis_runs WHERE id=$1 AND capture_id=$2 AND user_id=$3 AND domain='concrete' FOR UPDATE",[req.params.run,req.params.id,req.user.id])).rows[0];
 if(!photo||!run){await client.query('ROLLBACK');return res.status(404).json({error:'Analysis not found'});}
 if(run.review_status!=='suggested'){await client.query('ROLLBACK');return res.status(409).json({error:'This run has already been reviewed. Rerun for new suggestions.'});}
 if(!reject){
 for(const key of apply){if((photo['concrete_'+key]||null)!==(req.body.existing?.[key]||null)){await client.query('ROLLBACK');return res.status(409).json({error:'Photo fields changed. Reopen review before applying.'});}}
 await client.query(`UPDATE captures SET concrete_element=$3,concrete_condition=$4,concrete_severity=$5,concrete_reviewed_observation=$6 WHERE id=$1 AND user_id=$2`,[photo.id,req.user.id,apply.includes('element')?result.element:photo.concrete_element,apply.includes('condition')?result.condition:photo.concrete_condition,apply.includes('severity')?result.severity:photo.concrete_severity,result.observation]);
 }
 const status=reject?'rejected':JSON.stringify(result)===JSON.stringify(run.structured_result)?'reviewed':'corrected';
 await client.query('UPDATE visual_analysis_runs SET review_status=$1,reviewed_result=$2,reviewed_at=now() WHERE id=$3 AND user_id=$4',[status,reject?null:JSON.stringify(result),run.id,req.user.id]);
 await client.query('COMMIT');res.json({ok:true,status});
 }catch{await client.query('ROLLBACK');res.status(500).json({error:'Review could not be saved. Your photo and manual fields remain available.'});}finally{client.release();}
 });
}
module.exports={SCHEMA,registerVisualAnalysis};

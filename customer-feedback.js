const {isSuperAdmin}=require('./super-admin');
const CATEGORIES={problem:'bug_problem',idea:'new_feature',workflow:'feature_improvement',other:'ui_improvement'};
const SCHEMA=`CREATE TABLE IF NOT EXISTS customer_feedback_access(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,enabled BOOLEAN NOT NULL DEFAULT false,organization TEXT NOT NULL DEFAULT '');
ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS feedback_category TEXT, ADD COLUMN IF NOT EXISTS feedback_organization TEXT;`;
function canReview(user){return !!user&&(user.role==='admin'||user.is_testing_manager===true);}
function register(app,{pool,requireAuth,requireAdmin}){
 const superOnly=(req,res,next)=>isSuperAdmin(req.user)&&req.get('X-Photo-Notes-Admin-View')!=='regular'?next():res.status(403).json({error:'Super Admin access required'});
 app.get('/api/customer-feedback/access',requireAuth,async(req,res)=>{try{const row=(await pool.query('SELECT enabled FROM customer_feedback_access WHERE user_id=$1',[req.user.id])).rows[0];res.json({enabled:row?.enabled===true});}catch{res.status(500).json({error:'Feedback availability could not be checked'});}});
 app.get('/api/admin/customer-feedback',requireAuth,async(req,res)=>{if(!canReview(req.user))return res.status(403).json({error:'Admin access required'});const canManage=isSuperAdmin(req.user)&&req.get('X-Photo-Notes-Admin-View')!=='regular';try{const accounts=canManage?(await pool.query(`SELECT u.id,u.name,u.email,COALESCE(a.enabled,false) AS enabled,COALESCE(a.organization,'') AS organization FROM users u LEFT JOIN customer_feedback_access a ON a.user_id=u.id WHERE u.active=true ORDER BY u.name,u.id`)).rows:[];
 const feedback=(await pool.query(`SELECT i.id,i.description,i.feedback_category,i.feedback_organization,i.reported_edition,i.page_name,i.page_url,i.created_at,i.screenshot_path,i.management_status,u.name,u.email FROM issue_reports i JOIN users u ON u.id=i.user_id WHERE i.feedback_category IS NOT NULL ORDER BY i.created_at DESC`)).rows;res.json({accounts,feedback,can_manage:canManage});}catch{res.status(500).json({error:'Feedback could not be loaded'});}});
 app.post('/api/admin/customer-feedback/:id',requireAdmin,superOnly,async(req,res)=>{try{const id=Number(req.params.id),organization=String(req.body.organization||'').trim();if(!Number.isSafeInteger(id)||id<1||typeof req.body.enabled!=='boolean'||organization.length>200||(req.body.enabled&&!organization))return res.status(400).json({error:'Choose an account and enter its organization before enabling feedback'});
 if(!(await pool.query('SELECT id FROM users WHERE id=$1 AND active=true',[id])).rowCount)return res.status(404).json({error:'Account not found'});
 await pool.query(`INSERT INTO customer_feedback_access(user_id,enabled,organization) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET enabled=EXCLUDED.enabled,organization=EXCLUDED.organization`,[id,req.body.enabled,organization]);res.json({ok:true});}catch{res.status(500).json({error:'Feedback access could not be saved'});}});
}
async function validate(pool,req){
 if(req.body.feedback_category===undefined)return null;
 if(req.files?.voice?.length||req.files?.result_screenshot?.length)throw Object.assign(Error('Feedback supports one optional screenshot'),{status:400});
 const category=req.body.feedback_category;
 if(!Object.hasOwn(CATEGORIES,category))throw Object.assign(Error('Choose a feedback category'),{status:400});
 const access=(await pool.query('SELECT enabled,organization FROM customer_feedback_access WHERE user_id=$1',[req.user.id])).rows[0];
 if(!access?.enabled)throw Object.assign(Error('Customer feedback is not enabled for this account'),{status:403});
 req.body.issue_type=CATEGORIES[category];delete req.body.testing_assignment_id;delete req.body.testing_step_id;
 return {category,organization:access.organization};
}
module.exports={SCHEMA,CATEGORIES,register,validate,canReview};

'use strict';
const {currentEdition}=require('./editions');
const EDITIONS=['pro','paving','concrete','property','hoa','contractor','roofer'];
const SCHEMA=`
CREATE TABLE IF NOT EXISTS photo_follow_up_schedules (
 id bigserial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 edition text NOT NULL, subject_type text NOT NULL, subject_id integer NOT NULL,
 reference_capture_id integer REFERENCES captures(id) ON DELETE SET NULL,
 title text NOT NULL, instructions text NOT NULL DEFAULT '', timezone text NOT NULL,
 anchor_date date NOT NULL, recurrence jsonb, reminder_days integer NOT NULL DEFAULT 0,
 assigned_user_id integer REFERENCES users(id) ON DELETE SET NULL,
 active boolean NOT NULL DEFAULT true, next_index integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(subject_type IN ('capture','asset','inspection_stop','route','maintenance','job')),
 CHECK(reminder_days IN (0,1,3,7))
);
CREATE TABLE IF NOT EXISTS photo_follow_up_occurrences (
 id bigserial PRIMARY KEY, schedule_id bigint NOT NULL REFERENCES photo_follow_up_schedules(id) ON DELETE CASCADE,
 due_date date NOT NULL, title text NOT NULL, instructions text NOT NULL, timezone text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','skipped','cancelled')),
 result_capture_id integer REFERENCES captures(id) ON DELETE SET NULL,
 visit_id integer REFERENCES hoa_property_visits(id) ON DELETE SET NULL,
 photo_request_id integer,
 reason text, completed_by integer REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE(schedule_id,due_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS photo_follow_up_result_idx ON photo_follow_up_occurrences(result_capture_id) WHERE result_capture_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS photo_follow_up_due_idx ON photo_follow_up_occurrences(due_date) WHERE status='pending';
CREATE TABLE IF NOT EXISTS photo_follow_up_notifications (
 id bigserial PRIMARY KEY, occurrence_id bigint NOT NULL REFERENCES photo_follow_up_occurrences(id) ON DELETE CASCADE,
 user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('advance','due')), message text NOT NULL,
 read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(occurrence_id,user_id,kind)
);
CREATE TABLE IF NOT EXISTS photo_follow_up_push_subscriptions (
 subscription_id serial PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 endpoint text UNIQUE NOT NULL, subscription jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS photo_follow_up_push_delivery (
 notification_id bigint NOT NULL REFERENCES photo_follow_up_notifications(id) ON DELETE CASCADE,
 subscription_id integer NOT NULL REFERENCES photo_follow_up_push_subscriptions(subscription_id) ON DELETE CASCADE, attempts integer NOT NULL DEFAULT 0,
 next_try timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, error text,
 PRIMARY KEY(notification_id,subscription_id)
);
CREATE TABLE IF NOT EXISTS photo_follow_up_worker_state (
 id integer PRIMARY KEY CHECK(id=1), last_tick timestamptz, last_error text
);`;
function dateString(value){return value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);}
function validDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;const d=new Date(value+'T12:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===value&&Number(value.slice(0,4))>=2000&&Number(value.slice(0,4))<=2200;}
function today(timezone,now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
function recurrenceDate(anchor,rule,index){
 anchor=dateString(anchor);if(!rule)return index===0?anchor:null;
 const [y,m,d]=anchor.split('-').map(Number),date=new Date(Date.UTC(y,m-1,d,12));
 if(['day','week'].includes(rule.unit))date.setUTCDate(d+index*rule.interval*(rule.unit==='week'?7:1));
 else {const months=index*rule.interval*(rule.unit==='year'?12:1),first=new Date(Date.UTC(y,m-1+months,1,12)),last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();date.setUTCFullYear(first.getUTCFullYear(),first.getUTCMonth(),Math.min(d,last));}
 return date.toISOString().slice(0,10);
}
function validate(body){
 const title=String(body.title||'').trim().slice(0,200),instructions=String(body.instructions||'').trim().slice(0,2000),timezone=String(body.timezone||'');
 if(!title||!validDate(body.due_date))throw Error('Enter a title and a valid due date.');
 try{today(timezone);}catch{throw Error('Choose a valid time zone.');}if(!timezone)throw Error('Choose a time zone.');
 let recurrence=null;if(body.recurrence){const {unit,interval}=body.recurrence;if(!['day','week','month','year'].includes(unit)||!Number.isInteger(interval)||interval<1||interval>365)throw Error('Choose a valid calendar interval.');recurrence={unit,interval};}
 const reminder_days=Number(body.reminder_days||0);if(![0,1,3,7].includes(reminder_days))throw Error('Choose a supported advance reminder.');
 return {title,instructions,timezone,recurrence,reminder_days,due_date:body.due_date};
}
const eligible=user=>!!user&&EDITIONS.includes(currentEdition(user));
const fail=(message,status=400)=>Object.assign(Error(message),{status});
async function subject(db,user,type,id){
 id=Number(id);if(!Number.isInteger(id)||id<1)throw fail('Choose an available photographic subject.');
 if(type==='capture'){const r=(await db.query('SELECT *,photo_title AS title FROM captures WHERE id=$1 AND user_id=$2 AND photo_path IS NOT NULL',[id,user.id])).rows[0];if(!r)throw fail('Photo Note unavailable.',404);return {...r,reference_capture_id:r.id};}
 if(type==='job'){const r=(await db.query('SELECT *,name AS title FROM jobs WHERE id=$1 AND user_id=$2',[id,user.id])).rows[0];if(!r)throw fail('Job unavailable.',404);return r;}
 if(!['hoa','property'].includes(currentEdition(user)))throw fail('This subject requires Property Manager or HOA Pro.',403);
 const tables={asset:['hoa_assets','name'],maintenance:['hoa_maintenance_items','title'],route:['hoa_inspection_routes','name']};
 let r;
 if(type==='inspection_stop')r=(await db.query(`SELECT s.*,r.company_id,r.community_id,s.name AS title,a.primary_capture_id FROM hoa_inspection_stops s JOIN hoa_inspection_routes r ON r.id=s.route_id JOIN hoa_company_members m ON m.company_id=r.company_id LEFT JOIN hoa_assets a ON a.id=s.asset_id AND a.company_id=r.company_id WHERE s.id=$1 AND m.user_id=$2`,[id,user.id])).rows[0];
 else if(tables[type]){const [table,label]=tables[type];r=(await db.query(`SELECT s.*,s.${label} AS title FROM ${table} s JOIN hoa_company_members m ON m.company_id=s.company_id WHERE s.id=$1 AND m.user_id=$2`,[id,user.id])).rows[0];}
 if(!r)throw fail('Photographic subject unavailable.',404);return {...r,reference_capture_id:r.primary_capture_id||r.capture_id||null};
}
async function authorize(db,user,s,edit=false){
 if(Number(s.user_id)!==Number(user.id)&&(edit||Number(s.assigned_user_id)!==Number(user.id)))throw fail('Follow-up unavailable.',404);
 return subject(db,user,s.subject_type,s.subject_id);
}
async function assignment(db,user,context,value){
 if(value===null||value===undefined||value==='')return null;const id=Number(value);
 if(id===user.id)return id;
 if(!context.company_id||!(await db.query('SELECT 1 FROM hoa_company_members m JOIN users u ON u.id=m.user_id WHERE m.company_id=$1 AND m.user_id=$2 AND u.active=true',[context.company_id,id])).rowCount)throw fail('Choose an authorized team member.');return id;
}
async function generate(db,s,now=new Date()){
 if(!s.active)return;const target=today(s.timezone,now);if((await db.query("SELECT 1 FROM photo_follow_up_occurrences WHERE schedule_id=$1 AND status='pending' AND due_date>$2::date LIMIT 1",[s.id,target])).rowCount)return;let index=s.next_index;
 for(let n=0;n<200;n++){
  const date=recurrenceDate(s.anchor_date,s.recurrence,index);if(!date)break;
  await db.query(`INSERT INTO photo_follow_up_occurrences(schedule_id,due_date,title,instructions,timezone) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[s.id,date,s.title,s.instructions,s.timezone]);
  index++;if(date>target||!s.recurrence)break;
 }
 await db.query('UPDATE photo_follow_up_schedules SET next_index=$1 WHERE id=$2',[index,s.id]);
}
async function lockedOccurrence(db,user,id){
 const row=(await db.query(`SELECT o.*,s.user_id,s.assigned_user_id,s.subject_type,s.subject_id,s.reference_capture_id,s.edition,s.active FROM photo_follow_up_occurrences o JOIN photo_follow_up_schedules s ON s.id=o.schedule_id WHERE o.id=$1 FOR UPDATE OF s,o`,[id])).rows[0];
 if(!row)throw fail('Follow-up unavailable.',404);await authorize(db,user,row);return row;
}
async function completeCapture(db,user,occurrenceId,captureId){
 if(!eligible(user))throw fail('Follow-up photography requires Pro.',403);
 const o=await lockedOccurrence(db,user,occurrenceId);if(o.status!=='pending')throw fail('This occurrence is already closed.',409);if(o.subject_type==='route')throw fail('Complete the guided visit for this route.');
 const cap=(await db.query('SELECT * FROM captures WHERE id=$1 AND user_id=$2 AND photo_path IS NOT NULL',[captureId,user.id])).rows[0];
 if(!cap||new Date(cap.created_at)<new Date(o.created_at)||Number(cap.id)===Number(o.reference_capture_id))throw fail('Take a new follow-up photograph.');
 if((await db.query('SELECT 1 FROM photo_follow_up_occurrences WHERE result_capture_id=$1',[captureId])).rowCount)throw fail('This photo already satisfies another occurrence.',409);
 const context=await subject(db,user,o.subject_type,o.subject_id);
 if(o.subject_type==='inspection_stop'&&context.asset_id)await subject(db,user,'asset',context.asset_id);
 if(o.subject_type==='asset'||o.subject_type==='inspection_stop'&&context.asset_id)await db.query(`INSERT INTO hoa_asset_photos(asset_id,capture_id,photo_type) VALUES($1,$2,'condition') ON CONFLICT DO NOTHING`,[o.subject_type==='asset'?o.subject_id:context.asset_id,captureId]);
 if(o.subject_type==='maintenance'){
  await db.query(`INSERT INTO hoa_item_photos(item_id,capture_id,photo_stage) VALUES($1,$2,'follow_up')`,[o.subject_id,captureId]);
  await db.query(`INSERT INTO hoa_item_history(item_id,user_id,action,detail) VALUES($1,$2,'follow_up_photo',$3)`,[o.subject_id,user.id,JSON.stringify({occurrence_id:o.id,capture_id:captureId})]);
 }
 if(context.community_id&&context.property_area_id!==undefined)await db.query('UPDATE captures SET property_community_id=$1,property_area_id=$2 WHERE id=$3',[context.community_id,context.property_area_id||null,captureId]);
 if(o.subject_type==='job')await db.query('UPDATE captures SET job_id=$1 WHERE id=$2',[o.subject_id,captureId]);
 if(o.subject_type==='capture'&&context.job_id&&context.user_id===user.id)await db.query('UPDATE captures SET job_id=$1 WHERE id=$2',[context.job_id,captureId]);
 if(o.edition==='concrete')await db.query("UPDATE captures SET concrete_phase='follow_up',concrete_purpose='routine_review' WHERE id=$1",[captureId]);
 await db.query(`UPDATE photo_follow_up_occurrences SET status='completed',result_capture_id=$1,completed_at=now(),completed_by=$2 WHERE id=$3`,[captureId,user.id,o.id]);
 await db.query(`INSERT INTO capture_history(capture_id,user_id,action,detail) VALUES($1,$2,'follow_up_completed',$3)`,[captureId,user.id,JSON.stringify({occurrence_id:o.id,reference_capture_id:o.reference_capture_id})]);
 const s=(await db.query('SELECT * FROM photo_follow_up_schedules WHERE id=$1',[o.schedule_id])).rows[0];await generate(db,s);return o.id;
}
async function completeVisit(db,user,visitId){
 const rows=(await db.query(`SELECT o.id FROM photo_follow_up_occurrences o WHERE o.visit_id=$1 AND o.status='pending'`,[visitId])).rows;
 for(const row of rows){const o=await lockedOccurrence(db,user,row.id),v=(await db.query("SELECT * FROM hoa_property_visits WHERE id=$1 AND status='completed' AND route_id=$2",[visitId,o.subject_id])).rows[0];if(!v)throw fail('Complete every photographic stop first.');const stopState=(await db.query(`SELECT count(*)::int total,count(*) FILTER(WHERE status='complete' AND cardinality(capture_ids)>0)::int complete FROM hoa_visit_stops WHERE visit_id=$1`,[visitId])).rows[0];if(!stopState.total||stopState.total!==stopState.complete)throw fail('Complete every photographic stop first.');
 const stops=(await db.query(`SELECT vs.capture_ids,st.asset_id FROM hoa_visit_stops vs JOIN hoa_inspection_stops st ON st.id=vs.inspection_stop_id JOIN hoa_assets a ON a.id=st.asset_id AND a.company_id=$2 WHERE vs.visit_id=$1`,[visitId,v.company_id])).rows;
 for(const stop of stops)for(const captureId of stop.capture_ids)await db.query(`INSERT INTO hoa_asset_photos(asset_id,capture_id,photo_type) VALUES($1,$2,'condition') ON CONFLICT DO NOTHING`,[stop.asset_id,captureId]);
 await db.query(`UPDATE photo_follow_up_occurrences SET status='completed',completed_at=now(),completed_by=$1 WHERE id=$2`,[user.id,o.id]);await generate(db,(await db.query('SELECT * FROM photo_follow_up_schedules WHERE id=$1',[o.schedule_id])).rows[0]);}
}
async function tick(pool,now=new Date()){
 const db=await pool.connect();try{await db.query('BEGIN');if(!(await db.query('SELECT pg_try_advisory_xact_lock(73910326) AS locked')).rows[0].locked){await db.query('ROLLBACK');return;}
 const schedules=(await db.query(`SELECT s.* FROM photo_follow_up_schedules s JOIN users u ON u.id=s.user_id AND u.active=true WHERE s.active=true FOR UPDATE OF s`)).rows;
 for(const s of schedules)await generate(db,s,now);
 const completedVisits=(await db.query(`SELECT DISTINCT v.id,v.created_by FROM hoa_property_visits v JOIN photo_follow_up_occurrences o ON o.visit_id=v.id WHERE v.status='completed' AND o.status='pending'`)).rows;
 for(const v of completedVisits){const user=(await db.query('SELECT * FROM users WHERE id=$1 AND active=true',[v.created_by])).rows[0];if(user&&eligible(user)){try{await completeVisit(db,user,v.id);}catch(e){if(!e.status)throw e;}}}
 const rows=(await db.query(`SELECT o.*,s.user_id,s.assigned_user_id,s.reminder_days,s.subject_type,s.subject_id FROM photo_follow_up_occurrences o JOIN photo_follow_up_schedules s ON s.id=o.schedule_id JOIN users u ON u.id=s.user_id AND u.active=true WHERE o.status='pending'`)).rows;
 for(const o of rows){const date=dateString(o.due_date),local=today(o.timezone,now),advance=new Date(date+'T12:00:00Z');advance.setUTCDate(advance.getUTCDate()-o.reminder_days);const kind=date<=local?'due':o.reminder_days&&advance.toISOString().slice(0,10)<=local?'advance':null;if(!kind)continue;
 const recipient=o.assigned_user_id||o.user_id,user=(await db.query('SELECT * FROM users WHERE id=$1 AND active=true',[recipient])).rows[0];if(!user||!eligible(user))continue;try{await subject(db,user,o.subject_type,o.subject_id);}catch(e){if(e.status)continue;throw e;}
 await db.query(`INSERT INTO photo_follow_up_notifications(occurrence_id,user_id,kind,message) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[o.id,recipient,kind,`${kind==='due'?'Follow-up photograph due':'Upcoming follow-up photograph'}: ${o.title} (${date})`]);}
 await db.query(`INSERT INTO photo_follow_up_worker_state(id,last_tick,last_error) VALUES(1,now(),NULL) ON CONFLICT(id) DO UPDATE SET last_tick=now(),last_error=NULL`);await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');await pool.query(`INSERT INTO photo_follow_up_worker_state(id,last_error) VALUES(1,'Due processing failed') ON CONFLICT(id) DO UPDATE SET last_error=excluded.last_error`).catch(()=>{});throw e;}finally{db.release();}
}
function register(app,{pool,requireAuth}){
 const gate=(req,res,next)=>eligible(req.user)?next():res.status(403).json({error:'Scheduled photography requires an eligible Pro edition.'});
 const route=(method,path,fn)=>app[method]('/api/photo-follow-ups'+path,requireAuth,gate,async(req,res)=>{let db;try{db=await pool.connect();await db.query('BEGIN');const result=await fn(req,db);await db.query('COMMIT');res.json(result);}catch(e){if(db)await db.query('ROLLBACK');if(!e.status&&!/Enter |Choose /.test(e.message))console.error('[photo-follow-ups]',e.message);res.status(e.status||400).json({error:e.status||/Enter |Choose /.test(e.message)?e.message:'Follow-up could not be saved or loaded.'});}finally{db?.release();}});
 route('get','',async(req,db)=>{
 const schedules=(await db.query(`SELECT * FROM photo_follow_up_schedules WHERE user_id=$1 OR assigned_user_id=$1 ORDER BY created_at DESC`,[req.user.id])).rows,accessible=[];
 for(const s of schedules){try{await authorize(db,req.user,s);accessible.push(s);}catch(e){if(!e.status)throw e;}}
 const occurrences=accessible.length?(await db.query(`SELECT o.*,c.photo_path,c.created_at AS photo_created_at FROM photo_follow_up_occurrences o LEFT JOIN captures c ON c.id=o.result_capture_id WHERE o.schedule_id=ANY($1::bigint[]) ORDER BY o.due_date DESC`,[accessible.map(s=>s.id)])).rows:[];
 return {schedules:accessible.map(s=>({...s,can_edit:Number(s.user_id)===Number(req.user.id),anchor_date:dateString(s.anchor_date)})),occurrences:occurrences.map(o=>({...o,due_date:dateString(o.due_date),display_status:o.status==='pending'?(dateString(o.due_date)<today(o.timezone)?'overdue':dateString(o.due_date)===today(o.timezone)?'due':'upcoming'):o.status})),notifications:(await db.query('SELECT * FROM photo_follow_up_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200',[req.user.id])).rows.filter(n=>occurrences.some(o=>o.id===n.occurrence_id))};
 });
 route('post','/push/enable',async(req,db)=>{if(!require('./issue-cloud').validSubscription(req.body))throw fail('Unsupported push subscription.');await db.query(`INSERT INTO photo_follow_up_push_subscriptions(user_id,endpoint,subscription) VALUES($1,$2,$3) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription=excluded.subscription`,[req.user.id,req.body.endpoint,JSON.stringify(req.body)]);return {ok:true};});
 route('post','/push/disable',async(req,db)=>{await db.query('DELETE FROM photo_follow_up_push_subscriptions WHERE user_id=$1 AND endpoint=$2',[req.user.id,req.body.endpoint]);return {ok:true};});
 route('post','/notifications/read',async(req,db)=>{await db.query('UPDATE photo_follow_up_notifications SET read_at=now() WHERE user_id=$1',[req.user.id]);return {ok:true};});
 route('post','',async(req,db)=>{const b=req.body,data=validate(b),context=await subject(db,req.user,b.subject_type,b.subject_id),assigned=await assignment(db,req.user,context,b.assigned_user_id);let ref=context.reference_capture_id||null;
 if(b.reference_capture_id){const id=Number(b.reference_capture_id);if(id!==Number(ref))await subject(db,req.user,'capture',id);ref=id;}
 const s=(await db.query(`INSERT INTO photo_follow_up_schedules(user_id,edition,subject_type,subject_id,reference_capture_id,title,instructions,timezone,anchor_date,recurrence,reminder_days,assigned_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[req.user.id,currentEdition(req.user),b.subject_type,Number(b.subject_id),ref,data.title,data.instructions,data.timezone,data.due_date,data.recurrence&&JSON.stringify(data.recurrence),data.reminder_days,assigned])).rows[0];await generate(db,s);return s;});
 route('post','/:id/edit',async(req,db)=>{const s=(await db.query('SELECT * FROM photo_follow_up_schedules WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];if(!s)throw fail('Follow-up unavailable.',404);const context=await authorize(db,req.user,s,true),data=validate(req.body),assigned=await assignment(db,req.user,context,req.body.assigned_user_id);if(!s.active)throw fail('This schedule has ended.',409);if(data.due_date<=today(data.timezone))throw fail('Choose a future date when editing a schedule.');
 await db.query(`DELETE FROM photo_follow_up_occurrences WHERE schedule_id=$1 AND status='pending' AND due_date>(now() AT TIME ZONE timezone)::date AND visit_id IS NULL AND photo_request_id IS NULL`,[s.id]);
 const updated=(await db.query(`UPDATE photo_follow_up_schedules SET title=$1,instructions=$2,timezone=$3,anchor_date=$4,recurrence=$5,reminder_days=$6,assigned_user_id=$7,next_index=0,updated_at=now() WHERE id=$8 RETURNING *`,[data.title,data.instructions,data.timezone,data.due_date,data.recurrence&&JSON.stringify(data.recurrence),data.reminder_days,assigned,s.id])).rows[0];await generate(db,updated);return updated;});
 route('post','/:id/end',async(req,db)=>{const s=(await db.query('SELECT * FROM photo_follow_up_schedules WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];if(!s)throw fail('Follow-up unavailable.',404);await authorize(db,req.user,s,true);await db.query('UPDATE photo_follow_up_schedules SET active=false,updated_at=now() WHERE id=$1',[s.id]);await db.query(`UPDATE photo_follow_up_occurrences SET status='cancelled',reason='Schedule ended',completed_at=now() WHERE schedule_id=$1 AND status='pending' AND due_date>(now() AT TIME ZONE timezone)::date`,[s.id]);return {ok:true};});
 route('get','/occurrences/:id',async(req,db)=>{const o=await lockedOccurrence(db,req.user,req.params.id),context=await subject(db,req.user,o.subject_type,o.subject_id),reference=o.reference_capture_id?(await db.query('SELECT id,photo_path,note,address,latitude,longitude,created_at FROM captures WHERE id=$1',[o.reference_capture_id])).rows[0]:null;return {occurrence:{...o,due_date:dateString(o.due_date)},context,reference};});
 route('post','/occurrences/:id/:action',async(req,db)=>{const action=req.params.action,o=await lockedOccurrence(db,req.user,req.params.id);if(action==='complete'){await completeCapture(db,req.user,o.id,Number(req.body.capture_id));return {ok:true};}if(o.status!=='pending')throw fail('This occurrence is already closed.',409);
 if(['skip','cancel'].includes(action)){await db.query('UPDATE photo_follow_up_occurrences SET status=$1,reason=$2,completed_at=now(),completed_by=$3 WHERE id=$4',[action==='skip'?'skipped':'cancelled',String(req.body.reason||'').trim().slice(0,500),req.user.id,o.id]);await generate(db,(await db.query('SELECT * FROM photo_follow_up_schedules WHERE id=$1',[o.schedule_id])).rows[0]);return {ok:true};}
 if(action==='visit'){if(o.subject_type!=='route')throw fail('Select a route follow-up.');if(o.visit_id)return {id:o.visit_id};const r=await subject(db,req.user,'route',o.subject_id),v=(await db.query('INSERT INTO hoa_property_visits(company_id,community_id,route_id,created_by) VALUES($1,$2,$3,$4) RETURNING *',[r.company_id,r.community_id,r.id,req.user.id])).rows[0];await db.query(`INSERT INTO hoa_visit_stops(visit_id,inspection_stop_id,name,instructions,required_views,sort_order) SELECT $1,id,name,instructions,required_views,sort_order FROM hoa_inspection_stops WHERE route_id=$2`,[v.id,r.id]);if((await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='hoa_visit_stops' AND column_name='property_area_id'")).rowCount)await db.query('UPDATE hoa_visit_stops v SET property_area_id=s.property_area_id FROM hoa_inspection_stops s WHERE v.inspection_stop_id=s.id AND v.visit_id=$1',[v.id]);await db.query('UPDATE photo_follow_up_occurrences SET visit_id=$1 WHERE id=$2',[v.id,o.id]);return v;}
 if(action==='reconcile-visit'){if(!o.visit_id)throw fail('Start this scheduled visit first.');await completeVisit(db,req.user,o.visit_id);return {ok:true};}
 throw fail('Unsupported follow-up action.');});
}
async function push(pool,send=require('web-push').sendNotification){
 const db=await pool.connect();try{await db.query('BEGIN');if(!(await db.query('SELECT pg_try_advisory_xact_lock(73910327) AS locked')).rows[0].locked){await db.query('ROLLBACK');return;}
 if(!(await db.query("SELECT to_regclass('issue_push_config') AS name")).rows[0].name){await db.query('COMMIT');return;}
 const keys=(await db.query('SELECT * FROM issue_push_config WHERE id=1')).rows[0];if(!keys){await db.query('COMMIT');return;}
 await db.query(`INSERT INTO photo_follow_up_push_delivery(notification_id,subscription_id) SELECT n.id,s.subscription_id FROM photo_follow_up_notifications n JOIN photo_follow_up_push_subscriptions s ON s.user_id=n.user_id JOIN photo_follow_up_occurrences o ON o.id=n.occurrence_id WHERE n.read_at IS NULL AND o.status='pending' ON CONFLICT DO NOTHING`);
 const rows=(await db.query(`SELECT d.*,s.subscription,n.message,n.user_id,n.occurrence_id FROM photo_follow_up_push_delivery d JOIN photo_follow_up_push_subscriptions s ON s.subscription_id=d.subscription_id JOIN photo_follow_up_notifications n ON n.id=d.notification_id JOIN photo_follow_up_occurrences o ON o.id=n.occurrence_id WHERE d.sent_at IS NULL AND d.next_try<=now() AND d.attempts<8 AND n.read_at IS NULL AND o.status='pending' AND (n.kind='due' OR o.due_date>(now() AT TIME ZONE o.timezone)::date) ORDER BY d.next_try LIMIT 20 FOR UPDATE OF d`)).rows;
 for(const r of rows){const user=(await db.query('SELECT * FROM users WHERE id=$1 AND active=true',[r.user_id])).rows[0],o=(await db.query('SELECT s.* FROM photo_follow_up_occurrences o JOIN photo_follow_up_schedules s ON s.id=o.schedule_id WHERE o.id=$1',[r.occurrence_id])).rows[0];if(!user||!eligible(user)||!o)continue;try{await authorize(db,user,o);}catch(e){if(e.status)continue;throw e;}
 try{await send(r.subscription,JSON.stringify({title:'Photo Follow-Up',body:r.message,url:'/?followups=1',tag:'photo-follow-up-'+r.occurrence_id}),{vapidDetails:{subject:'https://photonotesapp.com',publicKey:keys.public_key,privateKey:keys.private_key},TTL:86400,timeout:10000});await db.query('UPDATE photo_follow_up_push_delivery SET sent_at=now(),error=NULL WHERE notification_id=$1 AND subscription_id=$2',[r.notification_id,r.subscription_id]);}
 catch(e){if([404,410].includes(e.statusCode))await db.query('DELETE FROM photo_follow_up_push_subscriptions WHERE subscription_id=$1',[r.subscription_id]);else await db.query(`UPDATE photo_follow_up_push_delivery SET attempts=attempts+1,next_try=now()+interval '1 minute'*power(2,attempts),error='Push delivery failed' WHERE notification_id=$1 AND subscription_id=$2`,[r.notification_id,r.subscription_id]);}}
 await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
function start(pool){let running=false;const run=async()=>{if(running)return;running=true;try{await tick(pool);await push(pool);}catch(e){console.error('[photo-follow-ups.worker]',e.message);}finally{running=false;}};void run();const timer=setInterval(run,60000);timer.unref();return timer;}
module.exports={EDITIONS,SCHEMA,eligible,dateString,validDate,today,recurrenceDate,validate,subject,authorize,generate,completeCapture,completeVisit,tick,push,register,start};

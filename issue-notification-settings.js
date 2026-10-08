const {isSuperAdmin}=require('./super-admin');
function registerNotificationSettings(app,{pool,requireAuth}){
 const owner=(req,res,next)=>requireAuth(req,res,()=>isSuperAdmin(req.user)&&req.get('X-Photo-Notes-Admin-View')!=='regular'?next():res.status(403).json({error:'Super Admin access required'}));
 app.get('/api/admin/issues/notification-settings',owner,async(req,res)=>{
  try{res.json((await pool.query('SELECT email_notifications_enabled,email_notifications_updated_at,email_reminders_enabled,email_interval_minutes,updated_at,schedule_version FROM issue_notification_settings WHERE id=1')).rows[0]);}
  catch{res.status(503).json({error:'Notification settings unavailable'});}
 });
 app.post('/api/admin/issues/notification-settings',owner,async(req,res)=>{
  const {email_notifications_enabled,email_reminders_enabled,email_interval_minutes}=req.body||{};
  if(email_notifications_enabled!==undefined&&typeof email_notifications_enabled!=='boolean')return res.status(400).json({error:'Choose whether immediate email notifications are enabled.'});
  if(typeof email_reminders_enabled!=='boolean'||!Number.isInteger(email_interval_minutes)||email_interval_minutes<15||email_interval_minutes>10080)return res.status(400).json({error:'Choose whether email reminders are enabled and an interval from 15 minutes to 168 hours.'});
  let c;
  try{
   c=await pool.connect();
   await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(740194)');await c.query('SELECT pg_advisory_xact_lock(740195)');
   const row=(await c.query(`UPDATE issue_notification_settings SET
    email_notifications_updated_at=CASE WHEN email_notifications_enabled IS DISTINCT FROM COALESCE($4,email_notifications_enabled) THEN now() ELSE email_notifications_updated_at END,
    email_notifications_enabled=COALESCE($4,email_notifications_enabled),
    schedule_version=schedule_version+CASE WHEN email_reminders_enabled IS DISTINCT FROM $1 OR email_interval_minutes IS DISTINCT FROM $2 THEN 1 ELSE 0 END,
    updated_at=CASE WHEN email_reminders_enabled IS DISTINCT FROM $1 OR email_interval_minutes IS DISTINCT FROM $2 THEN now() ELSE updated_at END,
    email_reminders_enabled=$1,email_interval_minutes=$2,updated_by=$3 WHERE id=1
    RETURNING email_notifications_enabled,email_notifications_updated_at,email_reminders_enabled,email_interval_minutes,updated_at,schedule_version`,[email_reminders_enabled,email_interval_minutes,req.user.id,email_notifications_enabled??null])).rows[0];
   await c.query('COMMIT');res.json(row);
  }catch{if(c)await c.query('ROLLBACK').catch(()=>{});res.status(503).json({error:'Notification settings could not be saved'});}
  finally{c?.release();}
 });
}
module.exports={registerNotificationSettings};

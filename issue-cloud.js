const webpush = require('web-push');
function validSubscription(s) {
  try {
    const u = new URL(s.endpoint);
    const allowed = u.hostname === 'fcm.googleapis.com' || u.hostname === 'updates.push.services.mozilla.com' || u.hostname.endsWith('.push.apple.com') || u.hostname === 'web.push.apple.com' || u.hostname.endsWith('.notify.windows.com');
    return allowed && u.protocol === 'https:' && !u.port && !u.username && !u.password && s.endpoint.length < 2048 && /^[A-Za-z0-9_-]{87}$/.test(s.keys?.p256dh || '') && /^[A-Za-z0-9_-]{22}$/.test(s.keys?.auth || '');
  } catch { return false; }
}
async function initCloud(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS issue_push_config(id integer PRIMARY KEY, public_key text NOT NULL, private_key text NOT NULL);
    CREATE TABLE IF NOT EXISTS issue_push_subscriptions(id serial PRIMARY KEY,user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,endpoint text UNIQUE NOT NULL,subscription jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS issue_cloud_events(id bigserial PRIMARY KEY,issue_id integer NOT NULL REFERENCES issue_reports(id) ON DELETE CASCADE,status text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS issue_push_delivery(event_id bigint REFERENCES issue_cloud_events(id) ON DELETE CASCADE,subscription_id integer REFERENCES issue_push_subscriptions(id) ON DELETE CASCADE,attempts integer NOT NULL DEFAULT 0,next_try timestamptz NOT NULL DEFAULT now(),sent_at timestamptz,error text,PRIMARY KEY(event_id,subscription_id));
    CREATE TABLE IF NOT EXISTS issue_cloud_state(id integer PRIMARY KEY,last_tick timestamptz,last_error text);
    CREATE TABLE IF NOT EXISTS issue_cloud_dispatch(issue_id integer PRIMARY KEY REFERENCES issue_reports(id) ON DELETE CASCADE,last_dispatched timestamptz,attempts integer NOT NULL DEFAULT 0,next_try timestamptz NOT NULL DEFAULT now(),error text);
    CREATE OR REPLACE FUNCTION issue_cloud_changed() RETURNS trigger AS $$ BEGIN
      IF TG_OP='INSERT' THEN INSERT INTO issue_cloud_events(issue_id,status) VALUES(NEW.id,NEW.management_status);
      ELSIF NEW.management_status IS DISTINCT FROM OLD.management_status THEN INSERT INTO issue_cloud_events(issue_id,status) VALUES(NEW.id,NEW.management_status); END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS issue_cloud_change ON issue_reports;
    CREATE TRIGGER issue_cloud_change AFTER INSERT OR UPDATE OF management_status ON issue_reports FOR EACH ROW EXECUTE FUNCTION issue_cloud_changed();`);
  await pool.query('ALTER TABLE issue_cloud_state ADD COLUMN IF NOT EXISTS last_runner_tick timestamptz, ADD COLUMN IF NOT EXISTS runner_configured boolean, ADD COLUMN IF NOT EXISTS runner_url text');
  await pool.query('ALTER TABLE issue_cloud_state ADD COLUMN IF NOT EXISTS last_dispatch_check timestamptz, ADD COLUMN IF NOT EXISTS dispatch_error text');
  await pool.query(`CREATE TABLE IF NOT EXISTS issue_cloud_incidents(id bigserial PRIMARY KEY,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz);
    CREATE TABLE IF NOT EXISTS issue_cloud_incident_delivery(incident_id bigint REFERENCES issue_cloud_incidents(id),subscription_id integer REFERENCES issue_push_subscriptions(id) ON DELETE CASCADE,attempts integer NOT NULL DEFAULT 0,next_try timestamptz NOT NULL DEFAULT now(),sent_at timestamptz,PRIMARY KEY(incident_id,subscription_id));`);
  const keys = webpush.generateVAPIDKeys();
  await pool.query('INSERT INTO issue_push_config VALUES(1,$1,$2) ON CONFLICT DO NOTHING',[keys.publicKey,keys.privateKey]);
  return (await pool.query('SELECT public_key,private_key FROM issue_push_config WHERE id=1')).rows[0];
}
function registerCloud(app,{pool,requireAuth,requireAdmin,requireTestingQueueToken}) {
  app.get('/api/issues/push-key',requireAuth,async(req,res)=>{try {const r=await pool.query('SELECT public_key FROM issue_push_config WHERE id=1');res.json({publicKey:r.rows[0]?.public_key||null});}catch{res.status(503).json({error:'Notifications starting'});}});
  app.post('/api/issues/push-subscription',requireAuth,async(req,res)=>{
    if(!validSubscription(req.body))return res.status(400).json({error:'Unsupported notification subscription'});
    try {await pool.query(`INSERT INTO issue_push_subscriptions(user_id,endpoint,subscription) VALUES($1,$2,$3) ON CONFLICT(endpoint) DO UPDATE SET user_id=EXCLUDED.user_id,subscription=EXCLUDED.subscription,created_at=now()`,[req.user.id,req.body.endpoint,JSON.stringify(req.body)]);res.json({ok:true});}catch{res.status(500).json({error:'Could not enable notifications'});}
  });
  app.delete('/api/issues/push-subscription',requireAuth,async(req,res)=>{try{await pool.query('DELETE FROM issue_push_subscriptions WHERE endpoint=$1 AND user_id=$2',[req.body?.endpoint,req.user.id]);res.json({ok:true});}catch{res.status(500).json({error:'Could not disable notifications'});}});
  app.post('/api/automation/cloud-heartbeat',requireTestingQueueToken,async(req,res)=>{const url=String(req.body?.run_url||'');if(!/^https:\/\/github\.com\/zukor\/photo-notes-repair-worker\/actions\/runs\/\d+$/.test(url))return res.status(400).json({error:'Invalid run URL'});try{await pool.query('INSERT INTO issue_cloud_state(id,last_runner_tick,runner_configured,runner_url) VALUES(1,now(),$1,$2) ON CONFLICT(id) DO UPDATE SET last_runner_tick=now(),runner_configured=$1,runner_url=$2',[req.body.configured===true,url]);res.json({ok:true});}catch{res.status(503).json({error:'Worker status unavailable'});}});
  app.get('/api/automation/cloud-worker',requireTestingQueueToken,async(req,res)=>{try{const state=(await pool.query('SELECT last_tick,last_error,last_runner_tick,runner_configured,runner_url,last_dispatch_check,dispatch_error FROM issue_cloud_state WHERE id=1')).rows[0];res.json({...state,dispatch_configured:!!process.env.ISSUE_GITHUB_TOKEN,runner_enabled:process.env.ISSUE_CLOUD_RUNNER_ENABLED==='true'});}catch{res.status(503).json({error:'Worker starting'});}});
  app.get('/api/admin/cloud-worker',requireAdmin,async(req,res)=>{try{const s=(await pool.query('SELECT * FROM issue_cloud_state WHERE id=1')).rows[0];const counts=(await pool.query('SELECT count(*)::int AS subscribed_devices FROM issue_push_subscriptions')).rows[0];const delivery=(await pool.query('SELECT count(*) FILTER (WHERE sent_at IS NULL AND attempts>=5)::int AS failed_deliveries FROM issue_push_delivery')).rows[0];res.json({...s,...counts,...delivery,dispatch_configured:!!process.env.ISSUE_GITHUB_TOKEN,runner_enabled:process.env.ISSUE_CLOUD_RUNNER_ENABLED==='true'});}catch{res.status(503).json({error:'Worker starting'});}});
}
async function tickCloud(pool,keys,{send=webpush.sendNotification,fetcher=fetch,env=process.env}={}) {
  const client=await pool.connect();
  try {
    const locked=(await client.query('SELECT pg_try_advisory_lock(740193) AS locked')).rows[0].locked;if(!locked)return;
    // Events are durable. Only opt-in devices existing when the event occurred receive it.
    await client.query(`INSERT INTO issue_push_delivery(event_id,subscription_id)
      SELECT e.id,s.id FROM issue_cloud_events e JOIN issue_reports i ON i.id=e.issue_id
      JOIN issue_push_subscriptions s ON s.created_at<=e.created_at JOIN users u ON u.id=s.user_id
      WHERE e.created_at>now()-interval '7 days' AND e.status IN ('ready_to_test','blocked') AND ((u.role='admin') OR i.user_id=s.user_id)
      ON CONFLICT DO NOTHING`);
    const deliveries=(await client.query(`SELECT d.event_id,d.subscription_id,d.attempts,s.subscription,u.role,e.status,e.issue_id
      FROM issue_push_delivery d JOIN issue_cloud_events e ON e.id=d.event_id JOIN issue_reports i ON i.id=e.issue_id
      JOIN issue_push_subscriptions s ON s.id=d.subscription_id JOIN users u ON u.id=s.user_id
      WHERE d.sent_at IS NULL AND d.attempts<5 AND d.next_try<=now() AND e.status=i.management_status
      AND e.status IN ('ready_to_test','blocked') AND (e.status='blocked' OR NOT EXISTS (
        SELECT 1 FROM issue_push_delivery pending JOIN issue_cloud_events recent ON recent.id=pending.event_id
        JOIN issue_reports current_issue ON current_issue.id=recent.issue_id
        WHERE pending.subscription_id=d.subscription_id AND pending.sent_at IS NULL
        AND recent.status='ready_to_test' AND current_issue.management_status=recent.status
        AND recent.created_at>=now()-interval '60 seconds'))
      ORDER BY d.event_id LIMIT 100`)).rows;
    // One notification per device and outcome per cycle, with a short completion
    // buffer so related repairs arrive as one message rather than five alerts.
    const groups=new Map();for(const d of deliveries){const key=d.subscription_id+':'+d.status;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(d);}
    for(const rows of groups.values()) {
      const d=rows[0],ids=rows.map(r=>r.event_id),count=new Set(rows.map(r=>r.issue_id)).size;
      try {await send(d.subscription,JSON.stringify({title:'Photo Notes',body:d.status==='ready_to_test'?`${count} issue repair${count===1?' is':'s are'} deployed and ready for your test.`:'An issue needs attention. Open its record for the reason and next step.',url:d.role==='admin'?'/admin':'/?issues=1',tag:'photo-notes-issues-'+d.status}),{vapidDetails:{subject:'https://photonotesapp.com',publicKey:keys.public_key,privateKey:keys.private_key},TTL:86400,timeout:10000});await client.query('UPDATE issue_push_delivery SET sent_at=now(),error=NULL WHERE event_id=ANY($1::bigint[]) AND subscription_id=$2',[ids,d.subscription_id]);}
      catch(e){if([404,410].includes(e.statusCode))await client.query('DELETE FROM issue_push_subscriptions WHERE id=$1',[d.subscription_id]);else await client.query("UPDATE issue_push_delivery SET attempts=attempts+1,next_try=now()+interval '1 minute'*power(2,attempts),error=$3 WHERE event_id=ANY($1::bigint[]) AND subscription_id=$2",[ids,d.subscription_id,`Push delivery failed (${Number(e.statusCode)||0})`]);}
    }
    await dispatchRepairs(client,{fetcher,env});
    await notifyWorkerIncidents(client,keys,send);
    await client.query('INSERT INTO issue_cloud_state(id,last_tick,last_error) VALUES(1,now(),NULL) ON CONFLICT(id) DO UPDATE SET last_tick=now(),last_error=NULL');
  } finally {await client.query('SELECT pg_advisory_unlock(740193)').catch(()=>{});client.release();}
}
async function dispatchRepairs(client,{fetcher=fetch,env=process.env}={}) {
  if(env.ISSUE_CLOUD_RUNNER_ENABLED!=='true')return;
  // The database gate survives process restarts and serializes multiple replicas.
  const gate=await client.query("UPDATE issue_cloud_state SET last_dispatch_check=now() WHERE id=1 AND (last_dispatch_check IS NULL OR last_dispatch_check<now()-interval '30 seconds') RETURNING id");
  if(!gate.rowCount)return;
  let error=null;
  try {
    if(!env.ISSUE_GITHUB_TOKEN)throw Error('Add ISSUE_GITHUB_TOKEN in Railway to enable repair dispatch.');
    const base='https://api.github.com/repos/zukor/photo-notes-repair-worker/actions/workflows/issue-cloud-repair.yml';
    const headers={Authorization:`Bearer ${env.ISSUE_GITHUB_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json'};
    const runs=await fetcher(base+'/runs?per_page=30',{headers,redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!runs.ok)throw Error(`GitHub worker status returned ${runs.status}; check the dispatch credential and Actions availability.`);
    const active=(await runs.json()).workflow_runs?.find(r=>r.status!=='completed');
    if(active){if(Date.now()-Date.parse(active.created_at)>60*60*1000)error='A cloud run has not completed for over an hour. Review the private Actions run.';}
    else {
      const pending=(await client.query(`SELECT i.id FROM issue_reports i LEFT JOIN issue_cloud_dispatch d ON d.issue_id=i.id
        WHERE i.management_status IN ('new','reviewing','fixing','testing') AND (i.repair_lease_until IS NULL OR i.repair_lease_until<now())
        AND (d.next_try IS NULL OR d.next_try<=now()) ORDER BY i.created_at LIMIT 1`)).rows;
      for(const i of pending){
        const r=await fetcher(base+'/dispatches',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers,body:JSON.stringify({ref:'main',inputs:{issue_id:String(i.id),mode:'repair'}})});
        const problem=r.ok?null:`GitHub dispatch returned ${r.status}; repair has not started.`;
        await client.query(`INSERT INTO issue_cloud_dispatch(issue_id,last_dispatched,attempts,next_try,error) VALUES($1,CASE WHEN $2 THEN now() END,1,now()+interval '15 minutes',$3)
          ON CONFLICT(issue_id) DO UPDATE SET last_dispatched=CASE WHEN $2 THEN now() ELSE issue_cloud_dispatch.last_dispatched END,attempts=issue_cloud_dispatch.attempts+1,next_try=now()+interval '15 minutes',error=$3`,[i.id,r.ok,problem]);
        if(problem)error=problem;
      }
    }
  } catch(e){error=/^(Add ISSUE_|GitHub worker)/.test(e.message)?e.message:'Cloud dispatch could not reach GitHub. It will retry automatically.';}
  const previous=(await client.query('SELECT dispatch_error FROM issue_cloud_state WHERE id=1')).rows[0]?.dispatch_error;
  if(previous!==error){await client.query('UPDATE issue_cloud_incidents SET resolved_at=now() WHERE resolved_at IS NULL');if(error)await client.query('INSERT INTO issue_cloud_incidents(reason) VALUES($1)',[error]);}
  await client.query('UPDATE issue_cloud_state SET dispatch_error=$1 WHERE id=1',[error]);
}
async function notifyWorkerIncidents(client,keys,send){
  await client.query(`INSERT INTO issue_cloud_incident_delivery(incident_id,subscription_id)
    SELECT i.id,s.id FROM issue_cloud_incidents i JOIN issue_push_subscriptions s ON s.created_at<=i.created_at JOIN users u ON u.id=s.user_id
    WHERE i.resolved_at IS NULL AND u.role='admin' ON CONFLICT DO NOTHING`);
  const rows=(await client.query(`SELECT d.incident_id,d.subscription_id,s.subscription FROM issue_cloud_incident_delivery d
    JOIN issue_cloud_incidents i ON i.id=d.incident_id JOIN issue_push_subscriptions s ON s.id=d.subscription_id
    WHERE i.resolved_at IS NULL AND d.sent_at IS NULL AND d.attempts<5 AND d.next_try<=now() LIMIT 20`)).rows;
  for(const d of rows){try{await send(d.subscription,JSON.stringify({title:'Photo Notes worker needs attention',body:'Automatic repairs need attention. Open Admin for the reason and next step.',url:'/admin',tag:'photo-notes-worker-attention'}),{vapidDetails:{subject:'https://photonotesapp.com',publicKey:keys.public_key,privateKey:keys.private_key},TTL:86400,timeout:10000});await client.query('UPDATE issue_cloud_incident_delivery SET sent_at=now() WHERE incident_id=$1 AND subscription_id=$2',[d.incident_id,d.subscription_id]);}
    catch(e){if([404,410].includes(e.statusCode))await client.query('DELETE FROM issue_push_subscriptions WHERE id=$1',[d.subscription_id]);else await client.query("UPDATE issue_cloud_incident_delivery SET attempts=attempts+1,next_try=now()+interval '1 minute'*power(2,attempts) WHERE incident_id=$1 AND subscription_id=$2",[d.incident_id,d.subscription_id]);}}
}
async function startCloud(pool) {
  const keys=await initCloud(pool);let running=false;
  const tick=async()=>{if(running)return;running=true;try{await tickCloud(pool,keys);}catch{await pool.query("INSERT INTO issue_cloud_state(id,last_tick,last_error) VALUES(1,now(),'Worker cycle failed') ON CONFLICT(id) DO UPDATE SET last_error='Worker cycle failed'").catch(()=>{});}finally{running=false;}};
  await tick();const timer=setInterval(tick,2000);timer.unref();return()=>clearInterval(timer);
}
module.exports={validSubscription,initCloud,registerCloud,tickCloud,startCloud,dispatchRepairs};

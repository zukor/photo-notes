const crypto=require('crypto'),path=require('path');
const digest=value=>crypto.createHash('sha256').update(String(value||'')).digest('hex');
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
function validateRepairUpdate(body){
  if(!['reviewing','fixing','testing','blocked','ready_to_test'].includes(body.management_status))throw new Error('Worker may review, fix, block, or request retesting; only a person confirms resolution');
  const fields={};for(const [k,max] of Object.entries({fix_summary:5000,retest_instructions:5000,verification:10000,blocked_reason:3000,admin_notes:10000}))if(body[k]!==undefined){if(typeof body[k]!=='string'||body[k].length>max)throw new Error('Invalid '+k);fields[k]=body[k].trim();}
  if(body.management_status==='blocked'&&!fields.blocked_reason)throw new Error('A blocked issue needs a concrete explanation or question');
  if(body.management_status==='ready_to_test'){
    if(!fields.fix_summary||!fields.retest_instructions||!fields.verification||!sha(body.fix_commit)||!sha(body.deployed_commit))throw new Error('A tested, deployed fix requires full commit IDs, verification, summary, and retest instructions');
    fields.release_reference=body.deployed_commit;fields.fix_commit=body.fix_commit;
  }
  return fields;
}
function registerIssueRepair(app,{pool,requireAuth,requireAdmin,requireTestingQueueToken,uploadDir}){
  app.get('/api/automation/testing-queue',requireTestingQueueToken,async(req,res)=>{try{
    await pool.query("INSERT INTO issue_worker_state(id,last_checked) VALUES(1,now()) ON CONFLICT(id) DO UPDATE SET last_checked=now()");
    const {rows:issues}=await pool.query(`SELECT id,issue_type,description,page_name,page_url,reported_edition,app_version,viewport,user_agent,management_status,priority,fix_summary,release_reference,retest_instructions,verification,blocked_reason,reporter_details,tester_result,tester_notes,created_at,updated_at,repair_lease_until,(screenshot_path IS NOT NULL) AS has_screenshot,(voice_path IS NOT NULL) AS has_voice FROM issue_reports WHERE management_status NOT IN ('resolved','wont_fix','tester_confirmed') ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,created_at`);
    const history=issues.length?(await pool.query('SELECT issue_id,event,detail,created_at FROM issue_repair_events WHERE issue_id=ANY($1::int[]) ORDER BY created_at DESC LIMIT 500',[issues.map(i=>i.id)])).rows:[];
    res.json({issues,history});
  }catch(e){res.status(500).json({error:'queue unavailable'});}});
  app.get('/api/automation/issues/:id/attachment/:kind',requireTestingQueueToken,async(req,res)=>{try{
    if(!['screenshot','voice'].includes(req.params.kind))return res.status(400).json({error:'Invalid attachment type'});
    const col=req.params.kind==='voice'?'voice_path':'screenshot_path';const row=(await pool.query(`SELECT ${col} AS file FROM issue_reports WHERE id=$1`,[req.params.id])).rows[0];
    if(!row?.file||!/^\/uploads\/[^/\\]+$/.test(row.file))return res.status(404).json({error:'Attachment not found'});
    res.sendFile(path.join(uploadDir,path.basename(row.file)));
  }catch(e){res.status(500).json({error:'Attachment unavailable'});}});
  app.post('/api/automation/issues/:id/claim',requireTestingQueueToken,async(req,res)=>{
    const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({error:'Invalid issue'});
    const token=crypto.randomBytes(32).toString('hex');let client;
    try{client=await pool.connect();await client.query('BEGIN');
      const {rows}=await client.query(`UPDATE issue_reports SET repair_claim_hash=$1,repair_lease_until=now()+interval '45 minutes',management_status=CASE WHEN management_status='new' THEN 'reviewing' ELSE management_status END,updated_at=now() WHERE id=$2 AND management_status IN ('new','reviewing','fixing','testing') AND (repair_lease_until IS NULL OR repair_lease_until<now() OR repair_claim_hash=$3) RETURNING id,repair_lease_until`,[digest(token),id,req.body?.claim_token?digest(req.body.claim_token):'']);
      if(!rows.length){await client.query('ROLLBACK');return res.status(409).json({error:'Issue is already claimed or is not actionable'});}
      await client.query("INSERT INTO issue_repair_events(issue_id,event,detail) VALUES($1,'claimed','Worker claimed or renewed the repair lease')",[id]);await client.query('COMMIT');res.json({...rows[0],claim_token:token});
    }catch(e){if(client)await client.query('ROLLBACK');res.status(500).json({error:'Claim failed'});}finally{client?.release();}
  });
  app.post('/api/automation/issues/:id',requireTestingQueueToken,async(req,res)=>{
    let fields;try{fields=validateRepairUpdate(req.body||{});}catch(e){return res.status(400).json({error:e.message});}
    const id=Number(req.params.id);if(!Number.isInteger(id)||id<1||!req.body.claim_token)return res.status(400).json({error:'Issue and claim token required'});
    let client;try{client=await pool.connect();await client.query('BEGIN');
      const vals=[req.body.management_status],sets=['management_status=$1','updated_at=now()'];
      if(['reviewing','fixing','testing'].includes(req.body.management_status))sets.push("repair_lease_until=now()+interval '45 minutes'");
      for(const [key,value] of Object.entries(fields)){vals.push(value);sets.push(`${key}=$${vals.length}`);}
      if(req.body.management_status==='ready_to_test')sets.push("tester_notification_status='in_app'",'tester_notified_at=now()','tester_notification_error=NULL','blocked_reason=NULL');
      if(['blocked','ready_to_test'].includes(req.body.management_status))sets.push('repair_claim_hash=NULL','repair_lease_until=NULL');
      vals.push(id,digest(req.body.claim_token));
      const {rows}=await client.query(`UPDATE issue_reports SET ${sets.join(',')} WHERE id=$${vals.length-1} AND repair_claim_hash=$${vals.length} AND repair_lease_until>now() AND management_status IN ('reviewing','fixing','testing') RETURNING id,management_status,release_reference`,vals);
      if(!rows.length){await client.query('ROLLBACK');return res.status(409).json({error:'Claim expired or issue changed; reload the queue'});}
      const detail=JSON.stringify({status:req.body.management_status,...fields});
      await client.query("INSERT INTO issue_repair_events(issue_id,event,detail) VALUES($1,$2,$3)",[id,req.body.management_status,detail]);await client.query('COMMIT');res.json({ok:true,...rows[0]});
    }catch(e){if(client)await client.query('ROLLBACK');res.status(500).json({error:'Repair update failed'});}finally{client?.release();}
  });
  app.get('/api/admin/repair-status',requireAdmin,async(req,res)=>{try{const row=(await pool.query('SELECT last_checked FROM issue_worker_state WHERE id=1')).rows[0];res.json({queue_configured:!!process.env.TESTER_QUEUE_TOKEN,email_configured:!!process.env.RESEND_API_KEY,last_checked:row?.last_checked||null});}catch(e){res.status(500).json({error:'Worker status unavailable'});}});
  app.get('/api/issues/attention',requireAuth,async(req,res)=>{
    try{
      const {rows}=await pool.query(`SELECT u.is_tester,
        count(i.id) FILTER (WHERE i.management_status IN ('ready_to_test','blocked'))::int AS count,
        count(i.id) FILTER (WHERE u.is_tester AND i.management_status='ready_to_test' AND i.verification IS NOT NULL AND COALESCE(i.release_reference,'')<>'')::int AS ready_count
        FROM users u LEFT JOIN issue_reports i ON i.user_id=u.id WHERE u.id=$1 GROUP BY u.id`,[req.user.id]);
      res.json(rows[0]||{is_tester:false,count:0,ready_count:0});
    }catch(e){res.status(500).json({error:'Issue count unavailable'});}
  });
  app.get('/api/issues/:id/history',requireAuth,async(req,res)=>{try{
    const own=await pool.query('SELECT id FROM issue_reports WHERE id=$1 AND (user_id=$2 OR $3)',[req.params.id,req.user.id,req.user.role==='admin']);if(!own.rowCount)return res.status(404).json({error:'Issue not found'});
    // Private admin notes stay within the admin view.
    const {rows}=await pool.query('SELECT event,detail,created_at FROM issue_repair_events WHERE issue_id=$1 ORDER BY created_at',[req.params.id]);res.json(req.user.role==='admin'?rows:rows.map(r=>({event:r.event,created_at:r.created_at})));
  }catch(e){res.status(500).json({error:'History unavailable'});}});
  app.post('/api/issues/:id/details',requireAuth,async(req,res)=>{const detail=String(req.body?.details||'').trim();if(!detail||detail.length>5000)return res.status(400).json({error:'Enter 1–5,000 characters'});let client;
    try{client=await pool.connect();await client.query('BEGIN');const {rows}=await client.query("UPDATE issue_reports SET reporter_details=$1,management_status='new',blocked_reason=NULL,repair_claim_hash=NULL,repair_lease_until=NULL,updated_at=now() WHERE id=$2 AND user_id=$3 AND management_status='blocked' RETURNING id",[detail,req.params.id,req.user.id]);if(!rows.length){await client.query('ROLLBACK');return res.status(404).json({error:'Issue is not waiting for details'});}
      await client.query("INSERT INTO issue_repair_events(issue_id,event,detail) VALUES($1,'reporter_details',$2)",[req.params.id,detail]);await client.query('COMMIT');res.json({ok:true});
    }catch(e){if(client)await client.query('ROLLBACK');res.status(500).json({error:'Details could not be saved'});}finally{client?.release();}
  });
}
module.exports={registerIssueRepair,validateRepairUpdate,digest};

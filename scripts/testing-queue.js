#!/usr/bin/env node
// Safe production queue bridge for scheduled Codex review. It never prints
// credentials or tester email addresses. Run through `railway run` so the
// linked Photo Notes service supplies DATABASE_URL and optional Resend config.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized:false } : false,
});

function arg(name){const i=process.argv.indexOf(`--${name}`);return i>=0?String(process.argv[i+1]||''):'';}
function html(value){return String(value||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

async function list(){
  const issues=(await pool.query(`SELECT i.id,i.description,i.page_name,i.page_url,i.screenshot_path,i.viewport,i.user_agent,i.management_status,i.priority,i.created_at FROM issue_reports i WHERE i.management_status NOT IN ('resolved','wont_fix','tester_confirmed') ORDER BY i.created_at`)).rows;
  const assignments=(await pool.query(`SELECT id,assignment_key,assignee_name,title,status,tester_notes,submitted_at,updated_at FROM testing_assignments WHERE status='submitted' ORDER BY submitted_at`)).rows;
  process.stdout.write(JSON.stringify({issues,submitted_assignments:assignments},null,2)+'\n');
}

async function ready(){
  const id=Number(arg('id')),fix=arg('fix'),release=arg('release'),retest=arg('retest');
  if(!Number.isInteger(id)||!fix||!release||!retest)throw new Error('ready requires --id, --fix, --release, and --retest');
  const report=(await pool.query(`SELECT i.*,u.email,u.name FROM issue_reports i JOIN users u ON u.id=i.user_id WHERE i.id=$1`,[id])).rows[0];
  if(!report)throw new Error('issue not found');
  let notification='pending',notificationError=null;
  const key=process.env.RESEND_API_KEY;
  if(key){
    const from=process.env.ISSUE_REPORT_FROM||'Photo Notes Issues <issues@photonotesapp.com>',appUrl=process.env.APP_URL||'https://photonotesapp.com';
    try{
      const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({from,to:[report.email],subject:`Photo Notes issue #${id} is ready to retest`,html:`<h2>Your Photo Notes issue is ready to retest</h2><p><strong>What changed:</strong> ${html(fix)}</p><p><strong>Release:</strong> ${html(release)}</p><p><strong>How to retest:</strong></p><p>${html(retest)}</p><p><a href="${html(appUrl)}">Open Photo Notes</a>, then choose <strong>My Issue Reports</strong> to confirm whether it is fixed.</p>`})});
      if(!response.ok)throw new Error(`Resend returned ${response.status}`);notification='sent';
    }catch(e){notificationError=String(e.message||e).slice(0,500);}
  }else notificationError='Email delivery is not configured';
  await pool.query(`UPDATE issue_reports SET management_status='ready_to_test',fix_summary=$1,release_reference=$2,retest_instructions=$3,tester_notification_status=$4,tester_notification_error=$5,tester_notified_at=CASE WHEN $4='sent' THEN now() ELSE tester_notified_at END,updated_at=now() WHERE id=$6`,[fix,release,retest,notification,notificationError,id]);
  process.stdout.write(JSON.stringify({ok:true,issue_id:id,status:'ready_to_test',tester_notification:notification})+'\n');
}

(async()=>{try{if(process.argv[2]==='ready')await ready();else await list();}finally{await pool.end();}})().catch(error=>{console.error(error.message||error);process.exitCode=1;});

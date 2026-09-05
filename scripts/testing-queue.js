#!/usr/bin/env node
// Scoped production queue bridge for scheduled Codex review. It uses only the
// dedicated testing endpoint and never contacts testers.
const base=String(process.env.APP_URL||'https://photonotesapp.com').replace(/\/$/,'');
const token=process.env.TESTER_QUEUE_TOKEN;

function arg(name){const i=process.argv.indexOf(`--${name}`);return i>=0?String(process.argv[i+1]||''):'';}
async function request(path,options={}){if(!token)throw new Error('TESTER_QUEUE_TOKEN is not configured');const r=await fetch(base+path,{...options,headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...(options.headers||{})}});if(!r.ok)throw new Error(`testing queue returned ${r.status}`);return r.json();}

async function list(){
  process.stdout.write(JSON.stringify(await request('/api/automation/testing-queue'),null,2)+'\n');
}

async function ready(){
  const id=Number(arg('id')),fix=arg('fix'),release=arg('release'),retest=arg('retest');
  if(!Number.isInteger(id)||!fix||!release||!retest)throw new Error('ready requires --id, --fix, --release, and --retest');
  const result=await request(`/api/automation/issues/${id}`,{method:'POST',body:JSON.stringify({management_status:'ready_to_test',fix_summary:fix,release_reference:release,retest_instructions:retest})});
  process.stdout.write(JSON.stringify({ok:true,issue_id:id,...result})+'\n');
}

(async()=>{if(process.argv[2]==='ready')await ready();else await list();})().catch(error=>{console.error(error.message||error);process.exitCode=1;});

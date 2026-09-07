import {queue,seal,git,out} from './core.mjs';
const run=process.env.GITHUB_RUN_ID;let configured=false;
if(process.env.OPENAI_API_KEY){try{const r=await fetch('https://api.openai.com/v1/models',{headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY},signal:AbortSignal.timeout(15000),redirect:'error'});configured=r.ok;}catch{}}
await queue('/api/automation/cloud-heartbeat',{configured,run_url:`https://github.com/zukor/photo-notes-repair-worker/actions/runs/${run}`});
if(!configured){console.log('Cloud AI key missing; no issue claimed.');out('available','false');process.exit(0);}
const q=await queue('/api/automation/testing-queue');const requested=process.env.ISSUE_ID?Number(process.env.ISSUE_ID):null;
if(requested!==null&&(!Number.isInteger(requested)||requested<1))throw new Error('Invalid issue ID');
const issue=q.issues.find(i=>(!requested||i.id===requested)&&['new','reviewing','fixing','testing'].includes(i.management_status)&&(!i.repair_lease_until||new Date(i.repair_lease_until)<new Date()));
if(!issue){out('available','false');console.log('No actionable reports.');process.exit(0);}
const c=await queue(`/api/automation/issues/${issue.id}/claim`,{});
const sealed=seal({id:issue.id,claim_token:c.claim_token},process.env.TESTER_QUEUE_TOKEN);
out('sealed',sealed);out('id',String(issue.id));out('base',git(['rev-parse','HEAD']));out('available','true');
out('evidence',JSON.stringify({id:issue.id,description:issue.description,page_name:issue.page_name,edition:issue.reported_edition,viewport:issue.viewport,reporter_details:issue.reporter_details,has_screenshot:issue.has_screenshot,has_voice:issue.has_voice,history:q.history.filter(h=>h.issue_id===issue.id).slice(0,10)}));

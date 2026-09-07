import {queue,unseal} from './core.mjs';
if(!process.env.SEALED)process.exit(0);
const c=unseal(process.env.SEALED,process.env.TESTER_QUEUE_TOKEN);
let reason='The cloud repair could not pass all review, test, or deployment checks. The report remains unresolved and needs investigation.';
try{const p=JSON.parse(process.env.PROPOSAL||'{}');if(typeof p.blocked_reason==='string')reason=p.blocked_reason.slice(0,2000);}catch{}
await queue(`/api/automation/issues/${c.id}`,{claim_token:c.claim_token,management_status:'blocked',blocked_reason:reason,admin_notes:`Cloud run https://github.com/zukor/photo-notes-repair-worker/actions/runs/${process.env.GITHUB_RUN_ID}. No successful repair is claimed.`});

import crypto from 'node:crypto';import {execFileSync as exec} from 'node:child_process';import {queue,unseal,parseProposal,verifyLive} from './core.mjs';
const c=unseal(process.env.SEALED,process.env.TESTER_QUEUE_TOKEN),p=parseProposal(process.env.PROPOSAL),merged=process.env.MERGED;
exec('git',['fetch','origin','main']);exec('git',['merge-base','--is-ancestor',process.env.FIX,merged]);
const files={};for(const f of ['app.js','styles.css','i18n.js','send.js','sw.js'])files[f]=crypto.createHash('sha256').update(exec('git',['show',merged+':public/'+f],{maxBuffer:4e6})).digest('hex');
let verified;for(let n=0;n<30;n++){try{verified=await verifyLive(merged,files);break;}catch{}await new Promise(r=>setTimeout(r,10000));}if(!verified)throw new Error('Deployment verification timed out; issue remains open');
await new Promise(r=>setTimeout(r,10000));await verifyLive(merged,files);
await queue(`/api/automation/issues/${c.id}`,{claim_token:c.claim_token,management_status:'ready_to_test',fix_summary:p.summary,retest_instructions:p.retest,fix_commit:process.env.FIX,deployed_commit:merged,verification:`Independent AI review; regression failed before and passed after; full suite passed in isolated container. Reviewed commit ${process.env.PR}. Running Railway deployment ${verified.deployment} verified twice: database health, exact commit, and five live asset hashes match tested source.`});

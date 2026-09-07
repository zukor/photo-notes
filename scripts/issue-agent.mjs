#!/usr/bin/env node
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
const dir=path.join(os.homedir(),'.config','photo-notes'),configPath=path.join(dir,'issue-agent.json');
const config=fs.existsSync(configPath)?JSON.parse(fs.readFileSync(configPath,'utf8')):{};
const base=String(process.env.APP_URL||config.base_url||'https://photonotesapp.com').replace(/\/$/,'');
if(!['https://photonotesapp.com','http://127.0.0.1:4320','http://127.0.0.1:4318'].includes(base))throw new Error('Unapproved issue-queue host');
const token=process.env.TESTER_QUEUE_TOKEN||config.token;
const command=process.argv[2]||'queue',id=Number(process.argv[3]);
const opt=name=>{const i=process.argv.indexOf('--'+name);return i<0?'':process.argv[i+1]||'';};
async function request(route,body){if(!token)throw new Error('Issue queue credential is not configured');const r=await fetch(base+route,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(30000),headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok){let reason='';try{reason=(await r.json()).error||'';}catch{}throw new Error(`Queue ${r.status}: ${reason}`);}return r;}
const claimPath=()=>path.join(dir,`issue-${id}-claim.json`);
function claim(){if(!fs.existsSync(claimPath()))throw new Error('Claim the issue first');return JSON.parse(fs.readFileSync(claimPath(),'utf8')).claim_token;}
function git(args){return execFileSync('git',args,{encoding:'utf8',maxBuffer:10*1024*1024}).trim();}
async function main(){
 if(command==='queue'){console.log(JSON.stringify(await(await request('/api/automation/testing-queue')).json(),null,2));return;}
 if(!Number.isInteger(id)||id<1)throw new Error('Provide a positive issue ID');
 if(command==='claim'||command==='renew'){
   const d=await(await request(`/api/automation/issues/${id}/claim`,command==='renew'?{claim_token:claim()}:{})).json();
   fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(claimPath(),JSON.stringify(d),{mode:0o600});console.log(JSON.stringify({issue_id:id,claimed:true,expires:d.repair_lease_until}));return;
 }
 if(command==='attachment'){
   const kind=opt('kind');if(!['screenshot','voice'].includes(kind))throw new Error('Choose --kind screenshot or voice');
   const out=opt('out');if(!out)throw new Error('Choose --out local-path');const r=await request(`/api/automation/issues/${id}/attachment/${kind}`);fs.writeFileSync(out,Buffer.from(await r.arrayBuffer()),{mode:0o600});console.log('Attachment saved to '+out);return;
 }
 if(!['update','ready'].includes(command))throw new Error('Use queue, claim, renew, attachment, update, or ready');
 const file=opt('file');if(!file)throw new Error('Provide --file with the JSON repair details');const body=JSON.parse(fs.readFileSync(file,'utf8'));body.claim_token=claim();
 if(command==='ready'){
   if(!/^[a-f0-9]{40}$/.test(body.fix_commit||'')||!body.verification?.trim())throw new Error('Provide full fix_commit and test verification');
   const deployments=JSON.parse(execFileSync('railway',['deployment','list','--project','62580ecc-2e07-4e27-b2de-fedbb7bf263d','--environment','production','--service','f1c5c40a-c946-4c48-a750-a38a45ce4877','--limit','1','--json'],{encoding:'utf8',maxBuffer:1024*1024}));
   const latest=deployments[0],deployed=latest?.meta?.commitHash;
   if(latest?.status!=='SUCCESS'||!/^[a-f0-9]{40}$/.test(deployed||''))throw new Error('Latest production deployment is not verified successful');
   execFileSync('git',['merge-base','--is-ancestor',body.fix_commit,deployed]);
   const health=await fetch(base+'/api/health',{signal:AbortSignal.timeout(15000)});if(!health.ok||!(await health.json()).ok)throw new Error('Production health check failed');
   const response=await fetch(base+'/app.js?verify='+deployed,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Live app bundle unavailable');
   const live=await response.text(),expected=execFileSync('git',['show',deployed+':public/app.js'],{encoding:'utf8',maxBuffer:10*1024*1024});
   if(crypto.createHash('sha256').update(live).digest('hex')!==crypto.createHash('sha256').update(expected).digest('hex'))throw new Error('Live app does not match the deployed commit');
   body.management_status='ready_to_test';body.deployed_commit=deployed;body.verification+=`\nVerified Railway deployment ${latest.id}: SUCCESS; fix is contained in ${deployed}; live health and app bundle match.`;
 }else if(body.management_status==='ready_to_test')throw new Error('Use ready to verify deployment before requesting a retest');
 const result=await(await request(`/api/automation/issues/${id}`,body)).json();if(['blocked','ready_to_test'].includes(body.management_status))fs.rmSync(claimPath(),{force:true});console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.message||'Issue agent failed');process.exitCode=1;});

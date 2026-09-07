import fs from 'node:fs';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
export const allowed=['public/app.js','public/styles.css','public/i18n.js','public/send.js'];
export function git(args){return execFileSync('git',args,{encoding:'utf8',maxBuffer:4e6}).trim();}
export function seal(value,secret){const iv=crypto.randomBytes(12),key=crypto.createHash('sha256').update(secret).digest(),c=crypto.createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]).toString('base64url');}
export function unseal(value,secret){const data=Buffer.from(value,'base64url'),d=crypto.createDecipheriv('aes-256-gcm',crypto.createHash('sha256').update(secret).digest(),data.subarray(0,12));d.setAuthTag(data.subarray(12,28));return JSON.parse(Buffer.concat([d.update(data.subarray(28)),d.final()]).toString());}
export function parseProposal(raw){
 const p=JSON.parse(raw);if(p.blocked_reason){if(typeof p.blocked_reason!=='string'||p.blocked_reason.length>2000)throw new Error('Invalid blocked explanation');return p;}
 if(typeof p.summary!=='string'||p.summary.length<10||p.summary.length>3000||typeof p.retest!=='string'||p.retest.length<10||p.retest.length>3000)throw new Error('Missing repair explanation');
 if(!Array.isArray(p.changes)||!p.changes.length||p.changes.length>8||typeof p.test!=='string'||p.test.length<80||p.test.length>15000)throw new Error('Missing bounded changes and regression test');
 for(const c of p.changes){if(!allowed.includes(c.path)||typeof c.before!=='string'||!c.before||typeof c.after!=='string'||c.before===c.after||c.before.length+c.after.length>16000)throw new Error('Invalid change');
 // Sensitive or external-communication changes are routed to a person.
 if(/https?:|\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon|password|authorization|cookie|localStorage|sessionStorage|eval|requireAuth|requireAdmin|stripe|deleteUser)\b/i.test(c.before+'\n'+c.after)||/\bFunction\s*\(/.test(c.before+'\n'+c.after))throw new Error('Repair requires sensitive-code review');}
 return p;
}
export function applyProposal(p,id,{bump=true}={}){
 if(p.blocked_reason)throw new Error('Proposal is blocked');if(!Number.isInteger(id)||id<1)throw new Error('Invalid issue');
 for(const c of p.changes){const s=fs.readFileSync(c.path,'utf8');if(s.split(c.before).length!==2)throw new Error('Repair context is not unique');fs.writeFileSync(c.path,s.replace(c.before,c.after));}
 fs.writeFileSync(`test/cloud-report-${id}.test.js`,p.test);
 if(bump){const source=fs.readFileSync('public/index.html','utf8'),m=source.match(/app\.js\?v=(\d+)/);if(!m)throw new Error('Cannot find cache version');const old=m[1],next=String(Number(old)+1);
 for(const file of ['public/index.html','public/admin.html','public/sw.js','server.js','test/tensor-help.test.js']){let s=fs.readFileSync(file,'utf8');s=s.replaceAll('v='+old,'v='+next).replaceAll('v'+old+"'",'v'+next+"'").replace("currentEdition(req.user),'"+old+"'","currentEdition(req.user),'"+next+"'");fs.writeFileSync(file,s);}}
}
export function treeDigest(id){const files=[...allowed,'public/index.html','public/admin.html','public/sw.js','server.js','test/tensor-help.test.js',`test/cloud-report-${id}.test.js`];const hash=crypto.createHash('sha256');for(const f of files)hash.update(f+'\0').update(fs.readFileSync(f));return hash.digest('hex');}
export function approved(raw){const r=JSON.parse(raw);return r.approved===true&&typeof r.reason==='string'&&r.reason.length>15;}
export function out(k,v){fs.appendFileSync(process.env.GITHUB_OUTPUT,`${k}=${typeof v==='string'?v:JSON.stringify(v)}\n`);}
export async function queue(route,body){const token=process.env.TESTER_QUEUE_TOKEN;if(!token)throw new Error('Queue credential missing');const r=await fetch('https://photonotesapp.com'+route,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw new Error(`Queue request failed (${r.status})`);return r.json();}
export async function verifyLive(commit,files,{fetcher=fetch}={}){if(!/^[a-f0-9]{40}$/.test(commit))throw new Error('Invalid commit');const r=await fetcher('https://photonotesapp.com/api/release',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Release unavailable');const d=await r.json();if(!d.ok||d.commit!==commit||!d.deployment)throw new Error('Expected healthy deployment is not live');for(const [file,expected] of Object.entries(files)){const a=await fetcher('https://photonotesapp.com/'+file+'?verify='+commit,{signal:AbortSignal.timeout(15000)});if(!a.ok||crypto.createHash('sha256').update(Buffer.from(await a.arrayBuffer())).digest('hex')!==expected)throw new Error('Live asset mismatch: '+file);}return d;}

import fs from 'node:fs';import crypto from 'node:crypto';import {execFileSync as exec,spawnSync} from 'node:child_process';import {parseProposal,applyProposal,approved,treeDigest,out} from './core.mjs';
const id=Number(process.env.ISSUE_ID),p=parseProposal(process.env.PROPOSAL);if(p.blocked_reason||!approved(process.env.REVIEW))throw new Error('Repair did not pass independent review');
// This job has no production, AI, or publishing secrets. Proposed code runs only in a network-disabled container.
const marker=crypto.randomBytes(24).toString('hex');console.log('::stop-commands::'+marker);
const docker=['run','--rm','--user',`${process.getuid()}:${process.getgid()}`,'--network','none','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256','--memory','2g','--cpus','2','-v',`${process.cwd()}:/work:ro`,'-w','/work','node:22-bookworm'];
exec('docker',['pull','node:22-bookworm'],{stdio:'inherit'});
fs.writeFileSync(`test/cloud-report-${id}.test.js`,p.test);
const before=spawnSync('docker',[...docker,'node','--test',`test/cloud-report-${id}.test.js`],{timeout:90000,encoding:'utf8'});
if(before.error||before.status!==1||!/fail [1-9]/.test(before.stdout+before.stderr)){console.log((before.stdout+before.stderr).slice(-3000));throw new Error('Regression test did not reproduce the original failure');}
applyProposal(p,id);exec('git',['diff','--check']);
exec('docker',[...docker,'node','--test',`test/cloud-report-${id}.test.js`],{stdio:'inherit',timeout:90000});
exec('docker',[...docker,'npm','test'],{stdio:'inherit',timeout:180000});
console.log('::'+marker+'::');out('digest',treeDigest(id));out('passed','true');

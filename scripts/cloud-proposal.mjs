import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync as exec} from 'node:child_process';
const id=Number(process.env.ISSUE_ID),patch=process.env.PROPOSED_PATCH||'';
if(!Number.isInteger(id)||id<1)throw new Error('Invalid report ID');
if(patch.trim()==='NO_PATCH'){console.log('No reproducible code-only proposal. Report remains open.');process.exit(0);}
if(patch.length>100000||!patch.startsWith('diff --git '))throw new Error('Invalid repair patch');
const allowed=new Set(['public/app.js','public/styles.css','public/i18n.js','public/send.js']);
for(const line of patch.split('\n')){if(line.startsWith('diff --git ')){const m=line.match(/^diff --git a\/(\S+) b\/(\S+)$/);if(!m||m[1]!==m[2]||!allowed.has(m[1]))throw new Error('Proposal touches a protected path');}if(/^(new file mode|deleted file mode|old mode|new mode|rename |copy |GIT binary)/.test(line))throw new Error('Unsupported patch operation');}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pn-proposal-')),file=path.join(tmp,'repair.patch');fs.writeFileSync(file,patch.endsWith('\n')?patch:patch+'\n');
exec('git',['apply','--check',file]);exec('git',['apply',file]);exec('git',['diff','--check']);
// Never execute agent-proposed code in this credentialed publishing job.
const branch=`codex/cloud-issue-${id}-${process.env.GITHUB_RUN_ID}`;
exec('git',['checkout','-b',branch]);exec('git',['add','--',...allowed]);exec('git',['-c','user.name=Photo Notes Repair','-c','user.email=repair@users.noreply.github.com','commit','-m',`Propose repair for Photo Notes report ${id}`]);
exec('gh',['auth','setup-git']);exec('git',['push','origin',branch]);
const body=path.join(tmp,'body.md');fs.writeFileSync(body,`Code-only proposal for Photo Notes report #${id}.\n\nRequires review, regression tests, cache version update, deployment, and device retest. The report has not been marked fixed.\n`);
exec('gh',['pr','create','--draft','--title',`Proposed fix for Photo Notes report #${id}`,'--body-file',body],{stdio:'inherit'});

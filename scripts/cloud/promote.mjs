import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync as exec} from 'node:child_process';import {queue,unseal,parseProposal,applyProposal,approved,treeDigest,git,out} from './core.mjs';
const claim=unseal(process.env.SEALED,process.env.TESTER_QUEUE_TOKEN),p=parseProposal(process.env.PROPOSAL);
if(process.env.TEST_PASSED!=='true'||!approved(process.env.REVIEW))throw new Error('Review or test gate failed');
await queue(`/api/automation/issues/${claim.id}`,{claim_token:claim.claim_token,management_status:'fixing',fix_summary:p.summary,verification:'Independent AI review approved. Regression failed on original source and passed after repair. Full tests passed in a network-disabled container.'});
git(['fetch','origin','main']);if(git(['rev-parse','origin/main'])!==process.env.BASE)throw new Error('Main changed; repair needs a fresh run');
applyProposal(p,claim.id);if(treeDigest(claim.id)!==process.env.TEST_DIGEST)throw new Error('Tested tree does not match publishing tree');
// A repository-restricted SSH deploy key can publish only to Photo Notes.
// Generated regression source stays in the private run, never in the public repository.
const keyFile=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'pn-publish-')),'key');
fs.writeFileSync(keyFile,process.env.PHOTO_NOTES_DEPLOY_KEY,{mode:0o600});
try{
 git(['add','--','public/app.js','public/styles.css','public/i18n.js','public/send.js','public/index.html','public/admin.html','public/sw.js','server.js','test/tensor-help.test.js']);
 git(['-c','user.name=Photo Notes Repair','-c','user.email=repair@users.noreply.github.com','commit','-m',`Repair Photo Notes report ${claim.id}`]);const fix=git(['rev-parse','HEAD']);
 // Fast-forward only. A concurrent main update fails this push and requires a fresh run.
 exec('git',['push','git@github.com:zukor/photo-notes.git','HEAD:refs/heads/main'],{stdio:'inherit',env:{...process.env,GIT_SSH_COMMAND:`ssh -i ${keyFile} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes`}});
 out('fix',fix);out('merged',fix);out('pr',`https://github.com/zukor/photo-notes/commit/${fix}`);
}finally{fs.rmSync(keyFile,{force:true});}

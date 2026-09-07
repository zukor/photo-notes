import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {execFileSync as exec} from 'node:child_process';
const original=process.cwd(),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pn-cloud-smoke-'));
exec('git',['clone','--quiet','--local',original,tmp]);
for(const dir of ['scripts/cloud','test','node_modules'])fs.cpSync(path.join(original,dir),path.join(tmp,dir),{recursive:true});
const probe='function cloudRepairProbe(n){return n+1;}';fs.appendFileSync(path.join(tmp,'public/app.js'),'\n'+probe+'\n');
const p={summary:'Synthetic probe has an off-by-one error.',retest:'Verify synthetic probe returns three for one.',changes:[{path:'public/app.js',before:probe,after:'function cloudRepairProbe(n){return n+2;}'}],test:`const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');test('probe adds two',()=>{const s=fs.readFileSync('public/app.js','utf8'),f=s.match(/function cloudRepairProbe\\(n\\)\\{[^}]+\\}/)[0];assert.equal(vm.runInNewContext(f+';cloudRepairProbe(1)'),3);});`};
exec('node',['scripts/cloud/validate.mjs'],{cwd:tmp,stdio:'inherit',env:{...process.env,ISSUE_ID:'987654321',PROPOSAL:JSON.stringify(p),REVIEW:JSON.stringify({approved:true,reason:'Synthetic fixture verifies baseline and fixed behavior.'}),GITHUB_OUTPUT:path.join(tmp,'smoke-output')}});
console.log('Synthetic hosted regression failed before, passed after, and full suite passed. No report or production data changed.');fs.rmSync(tmp,{recursive:true,force:true});

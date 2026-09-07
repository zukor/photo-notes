const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {validateRepairUpdate,digest}=require('../issue-repair');
test('workers cannot self-confirm resolution or claim an unverified deployment',()=>{
 for(const management_status of ['resolved','tester_confirmed','wont_fix','anything'])assert.throws(()=>validateRepairUpdate({management_status}));
 assert.throws(()=>validateRepairUpdate({management_status:'ready_to_test',fix_summary:'Fixed'}));
 assert.throws(()=>validateRepairUpdate({management_status:'blocked',blocked_reason:' '}));
 const data=validateRepairUpdate({management_status:'ready_to_test',fix_summary:'Corrected input',verification:'Tests and live check passed',retest_instructions:'Repeat the input',fix_commit:'a'.repeat(40),deployed_commit:'b'.repeat(40)});assert.equal(data.release_reference,'b'.repeat(40));assert.equal(data.fix_commit,'a'.repeat(40));
 assert.equal(digest('secret').length,64);assert.notEqual(digest('secret'),'secret');
});
test('every edition exposes reporting and Road Issue Reporter can open its report list',()=>{
 const source=fs.readFileSync('public/app.js','utf8');
 assert.doesNotMatch(source,/!isIndustryProClient\(\)\s*\?\s*`<button class="issue-fab/);
 assert.doesNotMatch(source,/!isIndustryProClient\(\)\?'<button type="button" id="myIssues"/);
 assert.ok(source.indexOf("if (state.view === 'my-issues') renderMyIssueReports()")<source.indexOf("else if (isRoadIssuesClient()) { state.view='road-report'"));
});
test('ready client verifies deployment, commit ancestry, and actual live assets',()=>{
 const source=fs.readFileSync('scripts/issue-agent.mjs','utf8');
 for(const required of ["latest?.status!=='SUCCESS'","merge-base","--is-ancestor","/api/health","Live app does not match the deployed commit"])assert.ok(source.includes(required));
 assert.match(source,/Use ready to verify deployment/);
});

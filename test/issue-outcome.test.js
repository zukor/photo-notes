const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const s=fs.readFileSync('public/admin.html','utf8'),c={};vm.createContext(c);vm.runInContext(s.slice(s.indexOf('    function issueHasDeployedFix'),s.indexOf('    function issueCard')),c);
test('issue outcomes separate verified fixes, deployed retests, ideas and unresolved reports',()=>{
 for(const status of ['new','blocked','testing','fixing','reviewing'])assert.equal(c.issueOutcome({management_status:status,tester_result:'fixed'}),'Unresolved','old retest does not hide reopened issue');
 for(const status of ['tester_confirmed','resolved'])assert.equal(c.issueOutcome({management_status:status}),'Fixed');
 assert.equal(c.issueOutcome({management_status:'ready_to_test'}),'Unresolved');
 assert.equal(c.issueOutcome({management_status:'ready_to_test',verification:'passed',release_reference:'commit'}),'Fix deployed - awaiting retest');
 assert.equal(c.issueOutcome({management_status:'new',issue_type:'new_feature'}),'Idea - awaiting review');
 assert.equal(c.issueOutcome({management_status:'wont_fix'}),'Closed without a fix');
});

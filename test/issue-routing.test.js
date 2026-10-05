const test=require('node:test'),assert=require('node:assert/strict');
const {disposition,priority,summary}=require('../public/issue-routing');const {kind}=require('../issue-followup');
test('queues identify the responsible person and preserve unapproved ideas',()=>{
 assert.equal(disposition({management_status:'blocked',review_decision:'clarify'}),'waiting');
 assert.equal(disposition({management_status:'blocked',blocked_kind:'developer'}),'developer');
 assert.equal(disposition({management_status:'new',issue_type:'new_feature'}),'ideas');
 assert.equal(disposition({management_status:'new',issue_type:'new_feature',review_decision:'implement'}),'working');
 assert.equal(disposition({management_status:'blocked',blocked_kind:'decision'}),'decision');
 assert.equal(disposition({management_status:'tester_confirmed'}),'closed');
});
test('missing evidence and restricted file scopes are not product decisions',()=>{
 assert.equal(kind({blocked_reason:'Original photo is needed to reproduce.'}),'evidence');
 assert.equal(kind({blocked_reason:'Fix is outside the allowed files.'}),'developer');
 assert.equal(kind({blocked_reason:'The tester checked again and confirmed still happening.'}),'retry');
 assert.equal(kind({blocked_reason:'This changes storage behavior.'}),'decision');
 assert.equal(kind({blocked_reason:'The automatic repair attempt ended without a confirmed live fix. Request clarification if the report is unclear.'}),'retry');
});
test('wrong job evidence and repeated failures rank ahead of ordinary bugs',()=>{
 assert(priority({description:'Evidence from another job'}).score>priority({priority:'high'}).score);
 assert(priority({failed_attempts:2}).score>priority({}).score);
 assert(priority({affected_testers:3}).score>priority({}).score);
});
test('failed retest does not erase deployed evidence or claim confirmation',()=>{
 const s=summary({management_status:'new',release_reference:'sha',verification:'checked',tester_result:'still_happening',tester_notes:'Still missing photo',progress_events:[{event:'ready_to_test'}]});
 assert(s.deployed);assert.equal(s.actor,'Repair worker');assert.equal(s.reply.text,'Still missing photo');assert.match(s.action,/Queued/);
 assert.match(summary({management_status:'blocked'}).attempt,/No repair attempt/);
});

test('verified repairs are distinct from successful no-fix retests and administrative closures',()=>{
 const repaired={management_status:'tester_confirmed',tester_result:'fixed',fix_summary:'Corrected saving',fix_commit:'a'.repeat(40),release_reference:'b'.repeat(40),verification:'Passed'};
 assert.equal(disposition(repaired),'completed');
 for(const field of ['fix_summary','fix_commit','release_reference','verification','tester_result'])assert.equal(disposition({...repaired,[field]:null}),'closed');
 assert.equal(disposition({...repaired,management_status:'resolved'}),'closed');
 assert.equal(disposition({management_status:'wont_fix'}),'closed');
});
test('repeated failures belong to developer investigation and explicit product holds stay with Sam',()=>{
 assert.equal(disposition({management_status:'blocked',blocked_kind:'repeated_failure'}),'developer');
 assert.equal(kind({blocked_kind:'repeated_failure'}),'developer');
 assert.equal(summary({management_status:'blocked',blocked_kind:'developer'}).actor,'Developer');
 assert.equal(summary({management_status:'blocked',blocked_kind:'decision'}).actor,'Sam');
});

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

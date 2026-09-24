const test=require('node:test'),assert=require('node:assert/strict');
const {explain}=require('../public/issue-review-guidance');
const {checksFor}=require('../public/issue-retest-guidance');
test('location limitations recommend device checks and retest without claiming resolution',()=>{
 const issue={blocked_reason:'Exact accuracy depends on the device GPS location provider; the original inaccurate reading cannot be reproduced here.'};
 const guide=explain(issue);assert.equal(guide.action,'retest');assert.match(guide.why,/device settings and the browser/);assert.match(guide.recommendation,/permission/);assert(checksFor(issue).some(x=>x.includes('location is allowed')));
});
test('original evidence requirements recommend clarification rather than another blind repair',()=>{
 const guide=explain({blocked_reason:'The original blurred image is needed to evaluate this specific failure.'});assert.equal(guide.action,'clarify');assert.match(guide.recommendation,/original photo/);
});
test('failed automatic repairs and tester-confirmed failures recommend repair, not tester blame',()=>{
 assert.equal(explain({blocked_reason:'The automatic repair did not pass review testing or deployment verification.'}).action,'implement');
 assert.equal(explain({blocked_reason:'The tester checked again and confirmed the issue is still happening.'}).action,'implement');
});
test('missing service access must be checked before another repair',()=>{
 const guide=explain({blocked_reason:'API key is missing.'});assert.equal(guide.action,'setup');assert.match(guide.recommendation,/First have the service account/);assert.doesNotMatch(guide.why,/is currently missing/);
});
test('unknown reasons do not fabricate a diagnosis and original technical notes stay out of plain explanation',()=>{
 const guide=explain({blocked_reason:'Cloud run https://example.invalid/private?token=SECRET'});assert.equal(guide.action,'retest');assert.match(guide.why,/does not clearly identify/);assert.doesNotMatch(JSON.stringify(guide),/SECRET|https/);
});
test('pending clarification recommends waiting; ideas require an owner decision',()=>{
 assert.equal(explain({review_decision:'clarify'}).action,'wait');assert.equal(explain({issue_type:'ui_improvement'}).action,'decision');
});
test('specific setup cases retain distinct explanations',()=>{
 assert.match(explain({blocked_reason:'Older comparisons never stored that setting, so it cannot be reconstructed.'}).why,/never saved/);
 assert.match(explain({blocked_reason:'The map provider may not have sufficiently detailed imagery.'}).recommendation,/blank map/);
});
test('clarification draft requests relevant evidence without exposing private diagnosis',()=>{
 const {clarificationDraft}=require('../public/issue-review-guidance');
 const issue={issue_type:'bug_problem',management_status:'blocked',blocked_reason:'The original blurred image is needed to evaluate this failure. Private run https://example.invalid/SECRET'};
 const draft=clarificationDraft(issue);
 assert.match(draft,/original photo or file/);assert.match(draft,/exact steps/);assert.match(draft,/fields the app filled in/);
 assert.doesNotMatch(draft,/SECRET|https|Choose Request|both scan results/);
 assert.match(clarificationDraft({...issue,blocked_reason:'The original plate image and both readings are needed.'}),/both scan results/);
 for(const changes of [{management_status:'resolved'},{issue_type:'ui_improvement'},{review_decision:'clarify'},{blocked_reason:'API key is missing.'}])assert.equal(clarificationDraft({...issue,...changes}),'');
});
test('approved storage changes explain why they returned for review',()=>{
 const guide=explain({issue_type:'feature_improvement',management_status:'blocked',review_decision:'implement',blocked_reason:'The requested popup would change storage behavior, under the storage restriction.'});
 assert.match(guide.why,/instructions were saved and sent/);assert.match(guide.why,/not been implemented/);assert.match(guide.recommendation,/developer/);
});

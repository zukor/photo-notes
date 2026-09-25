const test=require('node:test'),assert=require('node:assert/strict');
const {rounds,title,resultLabel}=require('../public/issue-presentation');
test('issue name uses brief report summary, not only the page name',()=>{
 assert.equal(title({description:'What happened: The PDF is missing photos. More detail.',page_name:'Send'}),'The PDF is missing photos');
 assert(title({description:'A long report '.repeat(50)}).length<=85);
});
test('repeat retests preserve chronological fix, instructions, result, comments and owner decision',()=>{
 const events=[
 {event:'ready_to_test',created_at:'2026-01-01',detail:{fix_summary:'First fix',retest_instructions:'First steps'}},
 {event:'retest',created_at:'2026-01-02',detail:{result:'still_happening',notes:'Still missing'}},
 {event:'bug_review_implement',created_at:'2026-01-03',detail:{decision:'implement',instructions:'Include captions'}},
 {event:'ready_to_test',created_at:'2026-01-04',detail:{fix_summary:'Second fix',retest_instructions:'Second steps'}},
 {event:'retest',created_at:'2026-01-05',detail:{result:'fixed',notes:'Now correct'}}];
 const r=rounds({progress_events:events});assert.equal(r.length,2);
 assert.equal(r[0].comments[0].notes,'Still missing');assert.equal(r[0].decisions[0].notes,'Include captions');
 assert.equal(r[1].instructions,'Second steps');assert.equal(r[1].comments[0].date,'2026-01-05');
 assert.equal(resultLabel(r[1].comments[0].result),'Retest Succeeded');assert.equal(resultLabel('unable_to_test'),'Unable to Retest');
});

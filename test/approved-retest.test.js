const test=require('node:test'),assert=require('node:assert/strict');
const {approvedImplementation}=require('../issue-ui-review');
test('only recorded implementation approvals survive tester follow-up',()=>{
 for(const issue_type of ['ui_improvement','feature_improvement','new_feature']){
  const row={issue_type,review_decision:'implement',reviewed_by:1,implementation_instructions:'Approved scope'};
  assert.equal(approvedImplementation(row),true);
  for(const changes of [{review_decision:null},{review_decision:'clarify'},{reviewed_by:null},{implementation_instructions:' '}])assert.equal(approvedImplementation({...row,...changes}),false);
 }
 assert.equal(approvedImplementation({issue_type:'bug_problem',review_decision:'implement',reviewed_by:1,implementation_instructions:'Repair'}),false);
});
const {registerRetest}=require('../issue-retest');
for(const result of ['still_happening','unable_to_test','fixed'])test('approved improvement '+result+' retains owner identity',async()=>{
 let handler,update;const row={issue_type:'ui_improvement',review_decision:'implement',reviewed_by:1,implementation_instructions:'Approved scope',management_status:'ready_to_test',verification:'checked',release_reference:'release'};
 const client={query:async(sql,args)=>{if(sql.startsWith('SELECT *'))return {rows:[row]};if(sql.startsWith('SELECT count'))return {rows:[{n:0}]};if(sql.startsWith('UPDATE issue_reports'))update=args;return {rows:[]};},release(){}};
 registerRetest({post:(p,a,h)=>handler=h},{pool:{connect:async()=>client},requireAuth(){},ticketText:v=>v,logEvent(){}});
 let response;await handler({params:{id:'1'},user:{id:2},body:{result,notes:'Tester evidence'}},{status(n){assert.fail('Unexpected '+n)},json(v){response=v}});
 assert.equal(update[6],true);assert.equal(response.status,result==='fixed'?'tester_confirmed':result==='still_happening'?'new':'blocked');
 assert.equal(update[5],result==='unable_to_test'?'evidence':null);
});

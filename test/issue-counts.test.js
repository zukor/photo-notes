const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('public/admin.html','utf8');
const source=html.slice(html.indexOf('    function issueCounts('),html.indexOf('    function issueOptions('));
const box={innerHTML:''};const ctx={document:{getElementById:()=>box},esc:s=>s,issueDevice:()=>({label:'Desktop'})};vm.createContext(ctx);vm.runInContext(source,ctx);
test('issue totals distinguish unfinished work, deployed fixes, confirmed fixes and closed reports',()=>{
 const rows=['new','reviewing','fixing','testing','blocked','ready_to_test','tester_confirmed','resolved','wont_fix'].map(management_status=>({management_status,verification:'tested',release_reference:'release'}));
 assert.deepEqual(JSON.parse(JSON.stringify(ctx.issueCounts(rows))),{work:5,awaiting:1,resolved:2,closed:1,urgent:0});
 assert.equal(ctx.issueCounts([{management_status:'ready_to_test'}]).work,1);
});
test('confirmed reports remain visible in tester comparison with resolved count',()=>{
 ctx.renderIssueComparison([{user_id:1,user_name:'Sam',management_status:'tester_confirmed'},{user_id:1,user_name:'Sam',management_status:'ready_to_test',verification:'tested',release_reference:'release'}]);
 assert.match(box.innerHTML,/Sam · Desktop: 2 reports, 0 need work, 1 awaiting retest, 1 resolved/);
 assert.match(html,/renderIssueComparison\(scope\)/);
});

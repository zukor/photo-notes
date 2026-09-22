const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('public/admin.html','utf8');
const source=html.slice(html.indexOf('    function issueCounts('),html.indexOf('    function issueOptions('));
const ctx={};vm.createContext(ctx);vm.runInContext(source,ctx);
test('issue totals distinguish unfinished work, deployed fixes, confirmed fixes and closed reports',()=>{
 const rows=['new','reviewing','fixing','testing','blocked','ready_to_test','tester_confirmed','resolved','wont_fix'].map(management_status=>({management_status,verification:'tested',release_reference:'release'}));
 assert.deepEqual(JSON.parse(JSON.stringify(ctx.issueCounts(rows))),{work:5,awaiting:1,resolved:2,closed:1,urgent:0,ideas:0,blocked:1});
 assert.equal(ctx.issueCounts([{management_status:'ready_to_test'}]).work,1);
});
test('ideas stay separate from problems needing repair',()=>{
 const counts=ctx.issueCounts(['bug_problem','ui_improvement','feature_improvement','new_feature'].map(issue_type=>({issue_type,management_status:'new'})));
 assert.equal(counts.work,1);assert.equal(counts.ideas,3);
});
test('type filters separate each category and all ideas',()=>{
 const filterSource=html.slice(html.indexOf('    function matchesIssueType('),html.indexOf('    function renderIssues('));
 vm.runInContext(filterSource,ctx);
 const rows=['bug_problem','ui_improvement','feature_improvement','new_feature'].map(issue_type=>({issue_type}));
 for(const type of rows.map(i=>i.issue_type))assert.deepEqual(rows.filter(i=>ctx.matchesIssueType(i,type)).map(i=>i.issue_type),[type]);
 assert.equal(rows.filter(i=>ctx.matchesIssueType(i,'ideas')).length,3);assert.equal(rows.filter(i=>ctx.matchesIssueType(i,'all')).length,4);
});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('public/admin.html','utf8'),ctx={};vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('    function testerFilterPeople('),html.indexOf('    function populateIssueFilters(')),ctx);
test('tester filter includes designated testers without reports and retains historical reporters',()=>{
 const users=[{id:1,name:'Rolando Test',is_tester:true},{id:2,name:'Unassigned User',is_tester:false},{id:3,name:'Updated Name',is_tester:true}];
 const issues=[{user_id:3,user_name:'Old Name'},{user_id:3,user_name:'Old Name'},{user_id:4,user_name:'Former Tester'}];
 assert.deepEqual(JSON.parse(JSON.stringify(ctx.testerFilterPeople(users,issues))),[['4','Former Tester'],['1','Rolando Test'],['3','Updated Name']]);
 assert.deepEqual(JSON.parse(JSON.stringify(ctx.testerFilterPeople([],[]))),[]);
});

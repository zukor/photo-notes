const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('public/issue-reporter.js','utf8');
function build(body,history){
 const ctx=vm.createContext({localStorage:{getItem:()=>history},JSON});
 vm.runInContext(source.slice(source.indexOf('function issueReportDescription('),source.indexOf('async function submitIssueReport(')),ctx);
 return ctx.issueReportDescription(body);
}
test('issue diagnostics fit the API limit and retain the newest failure as complete JSON',()=>{
 const history=Array.from({length:200},(_,i)=>({at:'2026-10-04T00:00:00Z',event:i===199?'stop-timeout':'result',generation:i,version:345,active:true,detail:'interim',language:'en-US',edition:'general',visibility:'visible',mode:'installed'}));
 const description='Detailed phone reproduction. '.repeat(100),result=build(description,JSON.stringify(history));
 assert.ok(result.length<=10000);assert.ok(result.startsWith(description));
 const events=JSON.parse(result.split('Voice-note diagnostics (no note text or audio):\n')[1]);
 assert.equal(events.at(-1).event,'stop-timeout');assert.equal(events.at(-1).generation,199);assert.ok(events.length<100);
});
test('a long user description and malformed diagnostics remain reportable',()=>{
 for(const history of ['broken','{}','[]'])assert.equal(build('Phone reproduction',history),'Phone reproduction');
 const body='x'.repeat(9999);assert.equal(build(body,JSON.stringify([{event:'error'}])),body);
});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/app.js'),'utf8');
const helper=source.slice(source.indexOf('function speechRetestEvidence('),source.indexOf('async function submitIssueRetest('));
function run(history,notes){return vm.runInNewContext(helper+';speechRetestEvidence(notes)',{notes,localStorage:{getItem:()=>history},Date});}
test('failed speech evidence excludes content and stale events',()=>{const recent={at:new Date().toISOString(),version:407,event:'session-reused',mode:'browser',note:'PRIVATE',audio:'PRIVATE'};const old={...recent,at:'2026-01-01T00:00:00Z',event:'stale'};const text=run(JSON.stringify([old,recent]),'Second recording failed');assert(text.includes('session-reused'));assert(!text.includes('PRIVATE'));assert(!text.includes('stale'));assert.equal(run(JSON.stringify([recent]),'PDF file failed'),'PDF file failed');});
test('diagnostics preserve original notes and the API limit',()=>{const notes='recording '+ 'x'.repeat(4890);const text=run(JSON.stringify(Array.from({length:40},()=>({at:new Date().toISOString(),event:'started',version:407}))),notes);assert(text.startsWith(notes));assert(text.length<=5000);assert.equal(run('bad json','speech failed'),'speech failed');});
test('speech errors are retained only as recognized codes, never arbitrary content',()=>{
 const base={at:new Date().toISOString(),version:413,event:'error'};
 const text=run(JSON.stringify([{...base,detail:'aborted'},{...base,detail:'PRIVATE note text'},{...base,event:'result',detail:'PRIVATE transcript'}]),'Second recording failed');
 assert(text.includes('"error":"aborted"'));assert(!text.includes('PRIVATE'));
});

test('later result bursts retain the preceding failed recording boundary',()=>{
 const base={at:new Date().toISOString(),version:440,active:true,pending:false,finishing:false,mode:'browser'};
 const rows=[{...base,event:'request',generation:1},{...base,event:'no-result-timeout',generation:1},...Array.from({length:70},()=>({...base,event:'result',generation:2})),{...base,event:'stop',generation:2}];
 const text=run(JSON.stringify(rows),'Second recording failed');assert(text.includes('no-result-timeout'));assert(text.includes('request'));assert(text.length<=5000);
});

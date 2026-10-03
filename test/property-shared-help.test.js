const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function catalog(){const source=fs.readFileSync('public/help.js','utf8');const ctx=vm.createContext({matchMedia:()=>({matches:true}),navigator:{userAgent:''}});vm.runInContext(source.slice(source.indexOf('const core ='),source.indexOf('let context ='))+'\nglobalThis.topics=articles;',ctx);return ctx.topics;}
test('Property Manager receives every common Pro and HOA help topic',()=>{
 const topics=catalog();
 for(const source of ['pro','hoa'])for(const a of topics.filter(a=>a.editions.includes(source))){
  assert(a.editions.includes('property'),`${source} help must include Property Manager: ${a.title}`);
 }
});
test('Property Manager has help for capture and each property workspace',()=>{
 const topics=catalog().filter(a=>a.editions.includes('property'));
 for(const page of ['capture','hoa-communities','hoa-visits','hoa-visit','hoa-assets','hoa-asset','hoa-inspections','hoa-maintenance','hoa-dashboard','hoa-reports'])assert(topics.some(a=>a.page===page),`Missing ${page} help`);
 for(const feature of ['team','completion','cost','route','filter','notifications'])assert(topics.some(a=>(a.title+' '+a.text).toLowerCase().includes(feature)),`Missing ${feature} guidance`);
});

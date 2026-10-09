const test=require('node:test'),assert=require('node:assert/strict');
const {inventory,catalog}=require('../scripts/help-coverage.cjs');
test('every source control has authored Help, including specialist/admin/public screens',()=>{
 const records=inventory();assert(records.length>500);assert.deepEqual(records.filter(r=>!r.covered),[]);
});
test('all authored Help terms have definitions and instructions contain no placeholders',()=>{
 for(const r of [...catalog.rules,...catalog.generalGuidance]){assert(r.text.length>60);for(const term of r.terms)assert(catalog.terms[term],term);assert(!/TODO|TO VERIFY|coming soon/.test(r.text));}
 for(const r of catalog.textRules)for(const term of r.terms||[])assert(catalog.terms[term],term);
});
test('all entrypoints use the same live Help and startup enforces authored coverage',()=>{
 const fs=require('node:fs');
 const entry=fs.readFileSync('public/index.html','utf8');
 for(const asset of ['help.css','help-catalog.js','help.js']){
  const pattern=new RegExp('/'+asset.replaceAll('.','\\.')+'\\?v=\\d+');
  const url=entry.match(pattern)?.[0];assert(url,asset);
  for(const file of ['public/admin.html','public/install.html','public/photo-request.html','public/sw.js'])assert(fs.readFileSync(file,'utf8').includes(url),file+' '+asset);
  const urls=fs.readFileSync('server.js','utf8').match(new RegExp(pattern.source,'g'))||[];
  assert(urls.length>=3,asset);assert(urls.every(value=>value===url),asset);
 }
 const p=require('../package.json');assert(p.scripts.postinstall.includes('help-coverage'));assert(p.scripts.prestart.includes('help-coverage'));
});

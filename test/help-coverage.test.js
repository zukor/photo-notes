const test=require('node:test'),assert=require('node:assert/strict');
const {inventory,catalog}=require('../scripts/help-coverage.cjs');
test('every source control has authored Help, including specialist/admin/public screens',()=>{
 const records=inventory();assert(records.length>500);assert.deepEqual(records.filter(r=>!r.covered),[]);
});
test('all authored Help terms have definitions and instructions contain no placeholders',()=>{
 for(const r of catalog.rules){assert(r.text.length>60);for(const term of r.terms)assert(catalog.terms[term],term);assert(!/TODO|TO VERIFY|coming soon/.test(r.text));}
 for(const r of catalog.textRules)for(const term of r.terms||[])assert(catalog.terms[term],term);
});
test('all entrypoints use the same live Help and startup enforces authored coverage',()=>{
 const fs=require('node:fs');
 for(const file of ['public/index.html','public/admin.html','public/install.html']){const s=fs.readFileSync(file,'utf8');assert(s.includes('/help.css?v=332'));assert(s.includes('/help-catalog.js?v=333'));assert(s.includes('/help.js?v=332'));}
 const s=fs.readFileSync('server.js','utf8');assert.equal((s.match(/\/help.css\?v=332/g)||[]).length,3);
 const p=require('../package.json');assert(p.scripts.postinstall.includes('help-coverage'));assert(p.scripts.prestart.includes('help-coverage'));
});

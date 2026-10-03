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
 const fs=require('node:fs'),index=fs.readFileSync('public/index.html','utf8');
 const assets=['help.css','help-catalog.js','help.js'].map(asset=>index.match(new RegExp('/'+asset.replace('.','\\.')+'\\?v=\\d+'))[0]);
 for(const file of ['public/index.html','public/admin.html','public/install.html']){const s=fs.readFileSync(file,'utf8');for(const asset of assets)assert(s.includes(asset));}
 const server=fs.readFileSync('server.js','utf8');assert.equal(server.split(assets[0]).length-1,3);
 const p=require('../package.json');assert(p.scripts.postinstall.includes('help-coverage'));assert(p.scripts.prestart.includes('help-coverage'));
});

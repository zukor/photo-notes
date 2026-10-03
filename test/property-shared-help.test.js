const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function catalog(){const ctx={window:{}};vm.runInNewContext(fs.readFileSync('public/help-catalog.js','utf8'),ctx);return ctx.window.PhotoNotesHelpCatalog;}
test('Property Manager and HOA share contextual authored help without edition filtering',()=>{
 const source=fs.readFileSync('public/help.js','utf8');assert(!source.includes('a.editions.includes'));
 const c=catalog();for(const key of ['hoaTitle','data-visit','photos','comment'])assert(c.rules.some(r=>r.keys.includes(key)),key);
 for(const feature of ['team','completion','cost','route','filter','notifications'])assert(JSON.stringify(c).toLowerCase().includes(feature),feature);
});

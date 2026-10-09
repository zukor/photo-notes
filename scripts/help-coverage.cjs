// Release gate: every authored UI control must have Help. The live renderer supplies labels/order/options.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const sandbox={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'public/help-catalog.js'),'utf8'),sandbox);
const catalog=sandbox.window.PhotoNotesHelpCatalog;
const sources=fs.readdirSync(path.join(root,'public')).filter(f=>/\.(js|html)$/.test(f)&&!['help.js','help-catalog.js','i18n.js','sw.js','word-preview-frame.js'].includes(f)).map(f=>'public/'+f).concat(['server.js']);
function covered(keys,label,tag){return tag==='summary'||catalog.rules.some(r=>r.keys.some(k=>keys.some(v=>k.endsWith('*')?v.startsWith(k.slice(0,-1)):k===v)))||catalog.textRules.some(r=>new RegExp(r.match,'i').test(label));}
function inventory(){const records=[],seen=new Set();for(const file of sources){const text=fs.readFileSync(path.join(root,file),'utf8');const rx=/<(button|input|select|textarea|summary|a)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;let m;
 while((m=rx.exec(text))){const [,tag,attrs]=m;
  if(tag==='input'&&/type=["']hidden["']/.test(attrs))continue;
  const id=attrs.match(/\bid=["']([^"']+)["']/)?.[1]||'';
  const cls=attrs.match(/\bclass=["']([^"']+)["']/)?.[1]||'';
  const keys=[id.replace(/\$\{[^}]*\}/g,''),...cls.split(/\s+/),...Array.from(attrs.matchAll(/\b(data-[\w-]+)/g),m=>m[1]),attrs.match(/\bname=["']([^"']+)["']/)?.[1]].filter(Boolean);
  const end=text.slice(rx.lastIndex).indexOf(`</${tag}>`);
  let label=tag==='button'||tag==='summary'||tag==='a'?text.slice(rx.lastIndex,rx.lastIndex+(end>=0?end:0)).replace(/\$\{[^}]*\}/g,'').replace(/<[^>]*>/g,' '):attrs.match(/(?:placeholder|aria-label|title)=["']([^"']+)["']/)?.[1]||'';
  label=label.replace(/\s+/g,' ').trim();
  // Dynamic field helpers are separately audited by browser fixtures, which see the actual identifiers.
  if(!keys.length&&!label)continue;
  const key=JSON.stringify([file,tag,id,cls,label]);if(seen.has(key))continue;seen.add(key);
  records.push({file,tag,id,classes:cls,label,markup:m[0],covered:covered(keys,label,tag)});
 }
}return records;}
const records=inventory(),missing=records.filter(r=>!r.covered);
for(const article of catalog.generalGuidance||[]){
 if(!article.title||!article.text||!article.editions?.length)throw Error('Workflow Help needs a title, authored explanation and edition scope.');
 for(const term of article.terms||[])if(!catalog.terms[term])throw Error(`Workflow Help has an undefined Key Term: ${term}`);
}

if(require.main===module){
 if(process.argv.includes('--inventory')){fs.writeFileSync('/tmp/pn-help-coverage-inventory.json',JSON.stringify(records,null,2));console.log(`${records.length} distinct source controls`);}
 if(missing.length){console.error('Help is missing authored guidance for these controls:');for(const r of missing)console.error(`${r.file}: ${r.tag} ${r.id||r.classes} ${r.label.slice(0,120)}`);process.exitCode=1;}
 else console.log(`Help coverage passed: ${records.length} distinct source controls and ${Object.keys(catalog.terms).length} defined terms.`);
}
module.exports={inventory,catalog};

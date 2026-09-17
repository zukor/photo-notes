const PizZip = require('pizzip');
const TOKENS = ['PHOTO_NOTES_CONTENT', 'TITLE', 'DESCRIPTION', 'COMPANY_NAME'];
// Word may split a placeholder across runs for spell checking or formatting.
function normalizePlaceholders(xml) {
  return xml.replace(/<w:p\b[^>]*>(?:(?!<w:p\b)[\s\S])*?<\/w:p>/g, paragraph => {
    const nodes = [...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)];
    let offset = 0;
    const spans = nodes.map(m => { const start = offset; offset += m[1].length; return {m,start,end:offset,text:m[1]}; });
    const text = spans.map(s => s.text).join('');
    const matches = [...text.matchAll(/\{\{(PHOTO_NOTES_CONTENT|TITLE|DESCRIPTION|COMPANY_NAME)\}\}/g)].reverse();
    for (const match of matches) {
      const start=match.index,end=start+match[0].length;
      for (const s of spans) {
        if(s.end<=start||s.start>=end)continue;
        const a=Math.max(0,start-s.start),b=Math.min(s.text.length,end-s.start);
        s.text=s.text.slice(0,a)+(s.start<=start?match[0]:'')+s.text.slice(b);
      }
    }
    for(const s of spans.reverse()) {
      const at=s.m.index+s.m[0].indexOf('>')+1;
      paragraph=paragraph.slice(0,at)+s.text+paragraph.slice(at+s.m[1].length);
    }
    return paragraph;
  });
}
function applyTemplate(generatedBuffer, templateBuffer, values) {
  const template=new PizZip(templateBuffer),generated=new PizZip(generatedBuffer);
  let xml=normalizePlaceholders(template.file('word/document.xml').asText());
  let content=generated.file('word/document.xml').asText().match(/<w:body[^>]*>([\s\S]*?)<\/w:body>/)[1].replace(/<w:sectPr[\s\S]*?<\/w:sectPr>\s*$/,'');
  let rels=template.file('word/_rels/document.xml.rels')?.asText()||'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const generatedRels=generated.file('word/_rels/document.xml.rels')?.asText()||'';
  let n=1;
  const remap=new Map();
  for(const match of generatedRels.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const attrs=Object.fromEntries([...match[0].matchAll(/(\w+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
    if(!attrs.Type?.endsWith('/image'))continue;
    const file=generated.file('word/'+attrs.Target);if(!file)throw Error('Template image missing');
    let id;do{id='pnImage'+n++;}while(rels.includes(`Id="${id}"`));
    const target='media/'+id+'_'+attrs.Target.split('/').pop();
    template.file('word/'+target,file.asNodeBuffer());remap.set(attrs.Id,id);
    rels=rels.replace('</Relationships>',`<Relationship Id="${id}" Type="${attrs.Type}" Target="${target}"/></Relationships>`);
  }
  content=content.replace(/r:embed="([^"]+)"/g,(all,id)=>remap.has(id)?`r:embed="${remap.get(id)}"`:all);
  const marker=/<w:p\b[^>]*>(?:(?!<w:p\b)[\s\S])*?\{\{PHOTO_NOTES_CONTENT\}\}(?:(?!<w:p\b)[\s\S])*?<\/w:p>/;
  if(!marker.test(xml))throw Error('Template content placeholder missing');
  xml=xml.replace(marker,()=>content);
  const escape=v=>String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  for(const name of template.file(/word\/.*\.xml/).map(f=>f.name)) {
    let part=name==='word/document.xml'?xml:normalizePlaceholders(template.file(name).asText());
    for(const token of TOKENS.slice(1))part=part.replaceAll('{{'+token+'}}',()=>escape(values[token.toLowerCase()]));
    template.file(name,part);
  }
  let types=template.file('[Content_Types].xml').asText();
  for(const m of generated.file('[Content_Types].xml').asText().matchAll(/<Default\b[^>]*\/>/g)) {
    const ext=m[0].match(/Extension="([^"]+)"/)[1];
    if(!types.includes(`Extension="${ext}"`))types=types.replace('</Types>',m[0]+'</Types>');
  }
  template.file('[Content_Types].xml',types);template.file('word/_rels/document.xml.rels',rels);
  return template.generate({type:'nodebuffer',compression:'DEFLATE'});
}
module.exports={normalizePlaceholders,applyTemplate};

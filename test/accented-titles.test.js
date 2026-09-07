const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(value,language="en"){const handlers={},el={value,selectionStart:value.length,addEventListener:(name,fn)=>handlers[name]=fn,setSelectionRange(p){this.selectionStart=p;}};const c={uiLocale:()=>language};vm.createContext(c);const s=fs.readFileSync(process.env.APP_SOURCE||'public/app.js','utf8');vm.runInContext(s.slice(s.indexOf('function titleCaseInput'),s.indexOf('async function loadAreas')),c);c.titleCaseInput(el);return{el,handlers};}
test('Spanish accents and combining marks stay inside a word',()=>{for(const text of ['productos para botiquín','fotografía del jardín','fotografía del jardín']){const f=fixture(text);f.handlers.input({});assert.equal(f.el.value,text.replace(/(^| )\p{L}/gu,x=>x.toUpperCase()));assert.equal(f.el.selectionStart,text.length);}});
test('title input leaves unfinished IME composition alone',()=>{const f=fixture('botiquín');f.handlers.input({isComposing:true});assert.equal(f.el.value,'botiquín');f.handlers.compositionend({});assert.equal(f.el.value,'Botiquín');});

test('Spanish connecting words stay lowercase during incremental title entry',()=>{
 const f=fixture('', 'es-US');
 for(const letter of 'productos para jardín y fotos de patios') {f.el.value+=letter;f.el.selectionStart=f.el.value.length;f.handlers.input({});}
 assert.equal(f.el.value,'Productos para Jardín y Fotos de Patios');
 assert.equal(f.el.selectionStart,f.el.value.length);
});
test('Spanish first words capitalize while interior prepositions remain lowercase',()=>{
 const f=fixture('para trabajos de jardín con fotos', 'es-US');f.handlers.input({});
 assert.equal(f.el.value,'Para Trabajos de Jardín con Fotos');
 const en=fixture('photos for a patio','en-US');en.handlers.input({});assert.equal(en.el.value,'Photos For A Patio');
});

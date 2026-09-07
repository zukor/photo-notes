const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(value){const handlers={},attrs={},el={value,selectionStart:value.length,setAttribute:(k,v)=>attrs[k]=v,addEventListener:(name,fn)=>handlers[name]=fn,setSelectionRange(p){this.selectionStart=p;}};const c={};vm.createContext(c);const s=fs.readFileSync(process.env.APP_SOURCE||'public/app.js','utf8');vm.runInContext(s.slice(s.indexOf('function titleCaseInput'),s.indexOf('async function loadAreas')),c);c.titleCaseInput(el);return{el,attrs,input(event={}){handlers.input?.(event);},end(){handlers.compositionend?.({});}};}
test('editing a title does not capitalize the next letter after deletion',()=>{
 const f=fixture('Productos Para Jardín');
 f.el.value='Productos ara Jardín';f.el.selectionStart=10;f.input({inputType:'deleteContentBackward'});
 assert.equal(f.el.value,'Productos ara Jardín');assert.equal(f.el.selectionStart,10);
 f.el.value='Productos para Jardín';f.el.selectionStart=11;f.input();assert.equal(f.el.value,'Productos para Jardín');
});
test('titles preserve deliberate casing and accented composition',()=>{
 for(const text of ['productos para botiquín','Fotos de jardín y patio','NASA eBay iPhone','fotografía del jardín']){const f=fixture(text);f.input({isComposing:true});f.end();f.input();assert.equal(f.el.value,text);assert.equal(f.attrs.autocapitalize,'off');}
});

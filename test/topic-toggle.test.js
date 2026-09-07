const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/send.js','utf8');
function fixture(heading=null){
 let language='es',text='',writes=0,selected='Roads';
 const label={tagName:'LABEL',getAttribute:()=>heading,style:{},setAttribute(){},get textContent(){return text;},set textContent(v){text=v;writes++;}};
 const areas={previousElementSibling:label,style:{},children:[],querySelector:s=>s==='.pill.on'?{getAttribute:()=>selected}:null};
 const row={style:{}},input={parentElement:row};
 const tr=s=>language==='es'?({'Select Topic':'Seleccionar tema',Roads:'Carreteras'}[s]||s.replace(/^Select Topic: (.+)( [▴▾])$/,(_,a,c)=>`Seleccionar tema: ${a}${c}`)):s;
 const c={q:id=>({areas,newarea:input}[id]),tr,document:{addEventListener(){}}};vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('  var topicExpanded'),source.indexOf('  function apply()')),c);
 return {c,label,areas,row,setLanguage:v=>language=v,setSelected:v=>selected=v,settle(){for(let i=0;i<20;i++){const before=writes;c.fixTopics();const translated=tr(label.textContent);if(translated!==label.textContent)label.textContent=translated;if(writes===before)return true;}return false;}};
}
test('Spanish selected topic converges instead of alternating observer writes',()=>{
 const f=fixture();assert.equal(f.settle(),true);assert.match(f.label.textContent,/Seleccionar tema/);
 f.label.onclick();assert.equal(f.settle(),true);assert.equal(f.areas.style.display,'flex');assert.equal(f.row.style.display,'');
 f.label.onclick();assert.equal(f.settle(),true);assert.equal(f.areas.style.display,'none');
});
test('topic label updates after language or selection changes',()=>{
 const f=fixture();f.settle();f.setLanguage('en');assert.equal(f.settle(),true);assert.match(f.label.textContent,/Select Topic: Roads/);
 f.setSelected('');assert.equal(f.settle(),true);assert.doesNotMatch(f.label.textContent,/Roads/);
});

test('Basic Optional heading stays stable and expands the topic entry row',()=>{
 const f=fixture('Topic (optional)');f.setLanguage('en');f.setSelected('');
 assert.equal(f.settle(),true);assert.equal(f.label.textContent,'Topic (optional) ▾');
 assert.equal(f.label.style.textTransform,'none');
 f.label.onclick();assert.equal(f.settle(),true);assert.equal(f.row.style.display,'');
});

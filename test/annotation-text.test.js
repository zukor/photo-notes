require('../annotation-fonts');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),sharp=require('sharp');
const source=fs.readFileSync('server.js','utf8');
const context={sharp,console,Buffer,fmtWhen:()=> '09/17/2026 10:30 AM',fmtDims:()=> '12 x 18 ft',fmtDefect:()=> 'Crack'};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function escXml('),source.indexOf('// Owner-scoped, share-sized copies')),context);
const capture={created_at:'2026-09-17T15:30:00Z',address:'123 Main Street',latitude:29.5,longitude:-98.5,area_tags:['Roof']};
async function render(t,text,font='sans',outline=false){
 const base=await sharp({create:{width:1000,height:800,channels:3,background:'#ffffff'}}).png().toBuffer();
 const out=await context.burnOverlays(base,1000,800,[{t,text,font,x:4,y:20,size:3,color:outline?'#ffffff':'#000000',outline}],capture);
 return sharp(out).removeAlpha().raw().toBuffer();
}
for(const font of ['sans','serif','mono','heavy'])test(`bundled ${font} font renders distinct letters instead of missing-glyph boxes`,async()=>{
 const narrow=await render('custom','IIII',font),wide=await render('custom','MMMM',font);
 let changed=0;for(let i=0;i<wide.length;i+=3)if(wide[i]!==narrow[i])changed++;
 assert.ok(changed>200,`letters must have distinct glyphs, changed pixels: ${changed}`);
});
for(const type of ['datetime','address','gps','copyright','topic','dims','defect','custom'])test(`${type} annotation draws visible outlined text without system fonts`,async()=>{
 const pixels=await render(type,'Información © 2026','sans',true);
 let ink=0;for(let i=0;i<pixels.length;i+=3)if(pixels[i]<128)ink++;
 assert.ok(ink>100,`${type} has visible text strokes: ${ink}`);
});
test('font configuration is initialized before image rendering loads',()=>{
 assert.ok(source.indexOf("require('./annotation-fonts')")<source.indexOf("require('sharp')"));
 const config=fs.readFileSync(process.env.FONTCONFIG_FILE,'utf8');assert.match(config,/<dir prefix="relative">\.<\/dir>/);assert.doesNotMatch(config,/<include|\/usr\/share\/fonts/);
});

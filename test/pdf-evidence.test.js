const test=require('node:test'),assert=require('node:assert/strict'),PDF=require('pdfkit'),sharp=require('sharp'),fs=require('node:fs');
const evidence=require('../pdf-evidence');
test('paired evidence keeps details in separate columns across continuation pages',async()=>{
 let page=0;const calls=[];class Tracked extends PDF{addPage(...args){page++;return super.addPage(...args);}text(text,x,y,opts){calls.push({text,x,y,page});return super.text(text,x,y,opts);}}
 const doc=new Tracked({margin:48});doc.resume();doc.font(evidence.fontPath);
 const image=await sharp({create:{width:400,height:300,channels:3,background:'blue'}}).png().toBuffer();
 await evidence.pair(doc,[{label:'Before',image,details:['Before detail '.repeat(300),'Date: Before Date']},{label:'After',image,details:['After detail','Date: After Date']}]);doc.end();
 assert(page>1);assert(calls.filter(c=>String(c.text).includes('Before detail')).every(c=>c.x===48));assert(calls.filter(c=>String(c.text).includes('After detail')).every(c=>c.x===318));assert(calls.every(c=>c.y<720));assert(calls.some(c=>c.text==='Date: Before Date'));
});
test('Urdu uses bundled shaping font and preserves original text for PDF readers',async()=>{
 const doc=new PDF({margin:48});doc.font(evidence.fontPath);const chunks=[];doc.on('data',b=>chunks.push(b));const done=new Promise(r=>doc.on('end',r));
 const value='Location: Chak 274 Hakra, پنجاب';const blocks=await evidence.blocks(doc,value,246);
 assert(blocks[0].image);assert.equal(blocks[0].actual,value);assert(blocks[0].width<=246);assert(blocks[0].height<80);
 await evidence.text(doc,value);doc.end();await done;if(process.env.PDF_URDU_OUT)fs.writeFileSync(process.env.PDF_URDU_OUT,Buffer.concat(chunks));
});

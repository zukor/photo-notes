// Pango handles Unicode shaping and bidirectional text, including mixed Urdu/Latin.
require('./annotation-fonts');
const sharp=require('sharp'),path=require('node:path');
const fontPath=path.join(__dirname,'assets/annotation-fonts/LiberationSans-Regular.ttf');
const arabicFont=path.join(__dirname,'assets/annotation-fonts/NotoNaskhArabic-Regular.ttf');
const rtl=/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/;
const xml=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
async function blocks(doc,text,width,size=11){
 const result=[];
 for(const paragraph of String(text||'').split('\n')){
  if(!paragraph){result.push({height:6});continue;}
  if(rtl.test(paragraph)){
   const {data,info}=await sharp({text:{text:xml(paragraph),font:'Liberation Sans '+size,fontfile:arabicFont,width:Math.floor(width*3),dpi:216,rgba:true,spacing:3}}).png().toBuffer({resolveWithObject:true});
   // Keep tall Unicode paragraphs bounded so continuation pages always advance.
   for(let top=0;top<info.height;){
    let height=Math.min(1500,info.height-top);
    if(top+height<info.height){
      const {data:raw,info:ri}=await sharp(data).extract({left:0,top,width:info.width,height}).raw().toBuffer({resolveWithObject:true});
      for(let row=height-1;row>height-100;row--){let empty=true;for(let x=0;x<ri.width;x++){if(raw[(row*ri.width+x)*ri.channels+ri.channels-1]){empty=false;break;}}if(empty){height=row+1;break;}}
    }
    const image=top===0&&height===info.height?data:await sharp(data).extract({left:0,top,width:info.width,height}).png().toBuffer();
    result.push({image,width:info.width/3,height:height/3+5,actual:top===0?paragraph:undefined});top+=height;
   }
   continue;
  }
  doc.fontSize(size);let line='';
  for(const word of paragraph.split(/\s+/)){
   if(line&&doc.widthOfString(line+' '+word)>width){result.push({text:line,size,height:size*1.35});line='';}
   // Wrap unbroken identifiers without letting them escape their photo column.
   for(const char of (line?' ':'')+word){if(doc.widthOfString(line+char)>width&&line){result.push({text:line,size,height:size*1.35});line='';}line+=char;}
  }
  if(line)result.push({text:line,size,height:size*1.35});
  result.push({height:4});
 }
 return result;
}
function draw(doc,b,x,y,width){
 if(b.image){if(b.actual)doc.markContent('Span',{actual:b.actual});doc.image(b.image,x,y,{width:b.width,height:b.height-5});if(b.actual)doc.endMarkedContent();}
 else if(b.text)doc.fontSize(b.size).fillColor('#000').text(b.text,x,y,{width,lineBreak:false});
}
async function text(doc,value,{width=516,size=11}={}){
 const x=doc.x;for(const b of await blocks(doc,value,width,size)){
  if(doc.y+b.height>720){doc.addPage();doc.x=x;doc.y=48;}
  const y=doc.y;draw(doc,b,x,y,width);doc.x=x;doc.y=y+b.height;
 }
}
async function pair(doc,entries){
 const width=entries.length===1?516:246,columns=[];
 for(const entry of entries){
  const content=[];
  if(entry.image){const m=await sharp(entry.image).metadata(),scale=Math.min(width/m.width,(entries.length===1?340:240)/m.height);content.push({image:entry.image,width:m.width*scale,height:m.height*scale+5});content.push({height:10});}
  for(const value of entry.details)content.push(...await blocks(doc,value,width,11));
  columns.push(content);
 }
 let first=true;
 while(columns.some(c=>c.length)){
  if(!first)doc.addPage();
  const top=first?doc.y:48;let bottom=top;
  for(let i=0;i<columns.length;i++){
   const x=48+i*270;let y=top;
   doc.fontSize(12).fillColor('#000').text(entries[i].label+(first?'':' (Continued)'),x,y,{width});y+=22;
   while(columns[i].length){const b=columns[i][0];if(y+b.height>720)break;columns[i].shift();draw(doc,b,x,y,width);y+=b.height;}
   bottom=Math.max(bottom,y);
  }
  doc.x=48;doc.y=bottom;first=false;
 }
}
module.exports={fontPath,blocks,text,pair};

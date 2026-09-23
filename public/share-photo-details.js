// Put the caption into the shared copy so receiving apps cannot discard it.
// The saved original is never changed.
window.PhotoNotesShareImage={async withDetails(file,text){
 if(!file||!text)return file;
 const url=URL.createObjectURL(file),image=new Image();
 try{
  image.src=url;await image.decode();
  const width=Math.max(800,Math.min(1400,image.naturalWidth)),photoHeight=Math.round(width*image.naturalHeight/image.naturalWidth),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  const fontSize=24,lineHeight=32,padding=24,lines=[];ctx.font=`${fontSize}px Arial`;
  for(const paragraph of String(text).split('\n')){
   let line='';for(const character of paragraph){if(ctx.measureText(line+character).width>width-padding*2){lines.push(line);line='';}line+=character;}lines.push(line);
  }
  canvas.width=width;canvas.height=photoHeight+padding*2+lines.length*lineHeight;
  if(canvas.height>16000)throw new Error('The note is too long for a shared photo. Share a document to include all details.');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,width,photoHeight);ctx.fillStyle='#000';ctx.font=`${fontSize}px Arial`;ctx.textBaseline='top';lines.forEach((line,i)=>ctx.fillText(line,padding,photoHeight+padding+i*lineHeight));
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));canvas.width=canvas.height=0;if(!blob)throw new Error('Photo details could not be prepared');
  return new File([blob],file.name.replace(/\.[^.]+$/,'')+'-with-details.jpg',{type:'image/jpeg'});
 }finally{URL.revokeObjectURL(url);}
}};

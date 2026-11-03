'use strict';
const fs=require('fs');
module.exports=function(SAFE_UPLOAD_EXTENSIONS){
// Photos saved from the web often arrive as .jfif, .jpe or with no extension at all.
// Pick the extension from the name when it is a known safe type, then from the
// reported image or audio type, so a real photo is never stored as .bin.
const UPLOAD_EXTENSION_ALIASES = {'.jfif':'.jpg','.jpe':'.jpg','.pjpeg':'.jpg','.pjp':'.jpg','.tif':'.bin','.tiff':'.bin'};
const UPLOAD_MIME_EXTENSIONS = {'image/jpeg':'.jpg','image/jpg':'.jpg','image/pjpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/heic':'.heic','image/heif':'.heif','image/gif':'.gif','audio/mp4':'.m4a','audio/x-m4a':'.m4a','audio/m4a':'.m4a','audio/aac':'.aac','audio/mpeg':'.mp3','audio/wav':'.wav','audio/x-wav':'.wav','audio/webm':'.webm','audio/ogg':'.ogg','video/mp4':'.mp4','video/quicktime':'.mov','video/webm':'.webm','application/pdf':'.pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx'};
function safeUploadExtension(file){
  let ext=(String(file&&file.originalname||'').match(/\.[a-zA-Z0-9]+$/)||[''])[0].toLowerCase();
  ext=UPLOAD_EXTENSION_ALIASES[ext]||ext;
  if(SAFE_UPLOAD_EXTENSIONS.has(ext))return ext;
  const fromType=UPLOAD_MIME_EXTENSIONS[String(file&&file.mimetype||'').toLowerCase().split(';')[0].trim()];
  if(fromType)return fromType;
  return ext?'.bin':'.jpg';
}
// For files already stored as .bin, read the first bytes to name an email attachment.
function sniffImageExtension(filePath){
  try{const fd=fs.openSync(filePath,'r');const b=Buffer.alloc(16);fs.readSync(fd,b,0,16,0);fs.closeSync(fd);
    if(b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return '.jpg';
    if(b.slice(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return '.png';
    if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return '.webp';
    if(b.toString('ascii',0,3)==='GIF')return '.gif';
    if(b.toString('ascii',4,8)==='ftyp'){const brand=b.toString('ascii',8,12);if(/^(heic|heix|mif1|msf1|hevc)$/.test(brand))return '.heic';}
  }catch(e){}
  return null;
}
return {safeUploadExtension,sniffImageExtension};
};

'use strict';
// EXIF GPSImgDirection is camera direction; GPSTrack is movement and is never used.
// Tags and reference meanings: https://exiftool.org/TagNames/GPS.html
function cameraDirectionFromExif(exif) {
  try {
    if (!Buffer.isBuffer(exif)) return null;
    const data=exif.subarray(exif.subarray(0,6).equals(Buffer.from('Exif\0\0'))?6:0);
    const order=data.subarray(0,2).toString('ascii');
    if(!['II','MM'].includes(order))return null;
    const u16=offset=>order==='II'?data.readUInt16LE(offset):data.readUInt16BE(offset);
    const u32=offset=>order==='II'?data.readUInt32LE(offset):data.readUInt32BE(offset);
    if(u16(2)!==42)return null;
    function directory(offset){
      const count=u16(offset);if(count>128||offset+2+count*12+4>data.length)throw Error('Invalid directory');
      const tags=new Map();for(let i=0;i<count;i++){const p=offset+2+i*12;tags.set(u16(p),{type:u16(p+2),count:u32(p+4),p});}return tags;
    }
    const pointer=directory(u32(4)).get(0x8825);
    if(!pointer||pointer.type!==4||pointer.count!==1)return null;
    const gps=directory(u32(pointer.p+8)),ref=gps.get(0x10),direction=gps.get(0x11);
    if(!ref||ref.type!==2||ref.count!==2||!direction||direction.type!==5||direction.count!==1)return null;
    const north=String.fromCharCode(data[ref.p+8]);if(!['T','M'].includes(north))return null;
    const status=gps.get(9);if(status&&status.type===2&&status.count===2&&data[status.p+8]===86)return null;
    const p=u32(direction.p+8),denominator=u32(p+4);if(!denominator)return null;
    const degrees=u32(p)/denominator;if(!Number.isFinite(degrees)||degrees<0||degrees>=360)return null;
    return {degrees,source:north==='T'?'EXIF image direction, true north':'EXIF image direction, magnetic north'};
  } catch (_) { return null; }
}
async function readCameraDirection(path) {
  try{return cameraDirectionFromExif((await require('sharp')(path).metadata()).exif);}catch(_){return null;}
}
module.exports={cameraDirectionFromExif,readCameraDirection};

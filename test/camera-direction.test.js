const test=require('node:test'),assert=require('node:assert/strict');
const {cameraDirectionFromExif}=require('../camera-direction');
function exif({endian='II',ref='T',degrees=287,denominator=1,tag=0x11}={}){
 const b=Buffer.alloc(80),short=(v,p)=>endian==='II'?b.writeUInt16LE(v,p):b.writeUInt16BE(v,p),long=(v,p)=>endian==='II'?b.writeUInt32LE(v,p):b.writeUInt32BE(v,p);
 b.write(endian);short(42,2);long(8,4);short(1,8);short(0x8825,10);short(4,12);long(1,14);long(26,18);short(2,26);
 short(0x10,28);short(2,30);long(2,32);b.write(ref,36);short(tag,40);short(5,42);long(1,44);long(58,48);long(degrees,58);long(denominator,62);
 return Buffer.concat([Buffer.from('Exif\0\0'),b]);
}
test('explicit camera direction is read in both byte orders with its north reference',()=>{
 for(const endian of ['II','MM'])for(const ref of ['T','M']){const d=cameraDirectionFromExif(exif({endian,ref}));assert.equal(d.degrees,287);assert(d.source.includes(ref==='T'?'true north':'magnetic north'));}
 assert.equal(cameraDirectionFromExif(exif({degrees:0})).degrees,0);
});
test('missing, corrupt, movement headings and invalid directions never become camera direction',()=>{
 for(const b of [undefined,Buffer.alloc(4),exif().subarray(0,40),exif({tag:0xf}),exif({denominator:0}),exif({degrees:360}),exif({ref:'X'})])assert.equal(cameraDirectionFromExif(b),null);
});
test('uploaded JPEG image direction survives the real Sharp metadata reader',async()=>{
 const fs=require('node:fs/promises'),path=require('node:path'),dir=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'pn-camera-direction-'));
 try{const jpeg=await require('sharp')({create:{width:4,height:4,channels:3,background:'#fff'}}).jpeg().toBuffer(),metadata=exif(),header=Buffer.alloc(4);header.writeUInt16BE(0xffe1);header.writeUInt16BE(metadata.length+2,2);const file=path.join(dir,'photo.jpg');await fs.writeFile(file,Buffer.concat([jpeg.subarray(0,2),header,metadata,jpeg.subarray(2)]));const d=await require('../camera-direction').readCameraDirection(file);assert.equal(d.degrees,287);assert.equal(d.source,'EXIF image direction, true north');}finally{await fs.rm(dir,{recursive:true,force:true});}
});

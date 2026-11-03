const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const SAFE=new Set(['.jpg','.jpeg','.png','.webp','.heic','.heif','.gif','.m4a','.mp4','.mov','.webm','.ogg','.wav','.mp3','.aac','.caf','.docx','.pdf']);
const {safeUploadExtension,sniffImageExtension}=require('../upload-types')(SAFE);

test('photos with unusual or missing extensions are not stored as .bin',()=>{
  assert.equal(safeUploadExtension({originalname:'pothole.jfif',mimetype:'image/jpeg'}),'.jpg');
  assert.equal(safeUploadExtension({originalname:'pothole.jfif',mimetype:''}),'.jpg');
  assert.equal(safeUploadExtension({originalname:'image',mimetype:'image/png'}),'.png');
  assert.equal(safeUploadExtension({originalname:'photo.avif',mimetype:'image/webp'}),'.webp');
  assert.equal(safeUploadExtension({originalname:'blob',mimetype:'image/jpeg'}),'.jpg');
  assert.equal(safeUploadExtension({originalname:'IMG_1.HEIC',mimetype:'image/heic'}),'.heic');
});

test('pages and scripts are never given a servable extension',()=>{
  assert.equal(safeUploadExtension({originalname:'x.html',mimetype:'text/html'}),'.bin');
  assert.equal(safeUploadExtension({originalname:'x.svg',mimetype:'image/svg+xml'}),'.bin');
  assert.equal(safeUploadExtension({originalname:'x.js',mimetype:'image/jpeg'}),'.jpg');
});

test('stored .bin photos are recognized from their content',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ut-'));
  const jpg=path.join(dir,'a.bin');fs.writeFileSync(jpg,Buffer.from([0xff,0xd8,0xff,0xe0,0,0,0,0,0,0,0,0,0,0,0,0]));
  const png=path.join(dir,'b.bin');fs.writeFileSync(png,Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(8)]));
  const txt=path.join(dir,'c.bin');fs.writeFileSync(txt,'<html>hello world</html>');
  assert.equal(sniffImageExtension(jpg),'.jpg');assert.equal(sniffImageExtension(png),'.png');assert.equal(sniffImageExtension(txt),null);
});

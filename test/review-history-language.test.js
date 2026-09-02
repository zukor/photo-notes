const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');

test('photo cards and history panel use plain history language',()=>{
  assert.match(app,/>Photo History<\/button>/);
  assert.match(app,/>Photo History<\/div>/);
  assert.match(app,/>Technical file details<\/summary>/);
  assert.match(app,/>Changes<\/h3>/);
  assert.doesNotMatch(app,/>Verify Photo Evidence<\/button>/);
  assert.doesNotMatch(app,/>Photo Evidence Verification<\/div>/);
});

test('photo notes are presented as a clearly labeled field',()=>{
  assert.match(app,/class="photo-notes-heading">Notes<\/div>/);
  assert.match(app,/class="notetext photo-notes-box"/);
});

test('technical file identity remains available without dominating the history',()=>{
  assert.match(app,/SHA-256 file ID/);
  assert.match(app,/Original photo matches/);
  assert.match(app,/Your private note text is not shown in this history/);
});

test('Photo History shows the format detected from the current saved file',()=>{
  assert.match(server,/current_file_format/);
  assert.match(server,/await sharp\(currentFile\)\.metadata\(\)/);
  assert.match(server,/jpeg:'JPEG'[\s\S]*png:'PNG'[\s\S]*webp:'WebP'[\s\S]*heif:ext==='\.heic'\?'HEIC':'HEIF'/);
  assert.match(server,/res\.json\(\{capture,evidence,history,[^}]*current_file_format/);
  assert.match(app,/Current file format: \$\{d\.current_file_format\|\|'Unknown'\}/);
});

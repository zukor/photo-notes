const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');

test('HOA board exports contain only photo-backed maintenance findings',()=>{
  assert.match(server,/app\.get\('\/api\/hoa\/report'/);
  assert.match(server,/i\.capture_id IS NOT NULL OR EXISTS\(SELECT 1 FROM hoa_item_photos/);
  assert.match(server,/Every finding below is supported by property photo evidence/);
  assert.match(app,/Board Photo Report PDF/);
  assert.match(app,/Board Photo Report Word/);
});

test('HOA maintenance detail makes original and completed photos a comparison',()=>{
  assert.match(app,/Before & After Maintenance Evidence/);
  assert.match(app,/Original Condition/);
  assert.match(app,/Completed \/ Verified/);
  assert.match(server,/\['completed_work','final_verification'\]/);
});

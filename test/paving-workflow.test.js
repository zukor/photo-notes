const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const db=fs.readFileSync(path.join(root,'db.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');

test('delivery-ticket photos can be explicitly linked to an owned job',()=>{
  assert.match(db,/asphalt_tickets ADD COLUMN IF NOT EXISTS job_id INTEGER REFERENCES jobs/);
  assert.match(server,/async function ownedJobId/);
  assert.match(server,/job_id=\$13, status='saved'/);
  assert.match(app,/Link Ticket Photo to Job/);
  assert.match(app,/job_id:value\('tkJobLink'\)/);
});

test('Paving job report remains photo-first and includes supporting ticket and extra-work evidence',()=>{
  assert.match(server,/app\.get\('\/api\/paving\/jobs\/:id\/report'/);
  assert.match(server,/captures WHERE user_id=\$1 AND job_id=\$2 AND photo_path IS NOT NULL/);
  assert.match(server,/buildRenderUnits\(captures, await userPairs/);
  assert.match(server,/Delivery Ticket Evidence/);
  assert.match(server,/Photo-Backed Extra Work/);
  assert.match(app,/Job Evidence PDF/);
  assert.match(app,/Job Evidence Word/);
});

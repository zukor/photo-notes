const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const db=fs.readFileSync(path.join(root,'db.js'),'utf8');
const admin=fs.readFileSync(path.join(root,'public/admin.html'),'utf8');

test('Road Issues Reporting is a separate non-Pro administrator-selectable edition',()=>{
  assert.match(server,/roads:\{plan:'free',pro_type:'roads'\}/);
  assert.match(app,/function isRoadIssuesClient\(\)/);
  assert.match(app,/data-edition="roads"[\s\S]*>RIR</);
  assert.match(admin,/<option value="roads">Road Issues Reporting<\/option>/);
});

test('road reporter is one camera-only form with the requested issue choices',()=>{
  const form=app.slice(app.indexOf('function renderRoadIssueReport()'),app.indexOf('async function sendRoadIssueReport'));
  for(const type of ['Crack','Pothole','Curb','Water Pooling','Road Marking','Sign','Other Road Surface Issue']) assert.match(app,new RegExp(`'${type}'`));
  assert.match(form,/id="roadIssueType"/);
  assert.match(form,/id="photoCam"/);
  assert.match(form,/capture="environment"/);
  assert.match(form,/alt="Road issue photo preview" style="display:block"/);
  assert.match(form,/id="roadIssueSend">Send<\/button>/);
  assert.doesNotMatch(form,/photoLib|Choose from library|Record Note|id="note"|Select Topic/);
  assert.match(app,/isRoadIssuesClient\(\)\?'':`<div class="tabs workflow-tabs/);
});

test('road reporter header shows the cropped Photo Notes AI mark with its own subtitle',()=>{
  assert.match(app,/road-issues-logo" role="img" aria-label="Photo Notes AI"/);
  assert.match(app,/isRoadIssuesClient\(\)\?'Road Issues Reporting'/);
  const styles=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');
  assert.match(styles,/\.road-issues-logo[^}]*aspect-ratio:940\/118[^}]*overflow:hidden[^}]*photo-notes-ai-paving-pro-animated\.svg/);
});

test('road reports are stored before an attached-photo email is attempted',()=>{
  assert.match(db,/CREATE TABLE IF NOT EXISTS road_issue_reports/);
  assert.match(db,/photo_path\s+TEXT NOT NULL/);
  assert.match(server,/app\.post\('\/api\/road-issues',requireAuth,upload\.single\('photo'\)/);
  assert.match(server,/INSERT INTO road_issue_reports/);
  assert.match(server,/process\.env\.ROAD_ISSUE_EMAIL\|\|'zukor@earthlink\.net'/);
  assert.match(server,/attachments=\[\{filename:`road-issue-\$\{report\.id\}\$\{path\.extname\(local\)\|\|'\.jpg'\}`/);
});

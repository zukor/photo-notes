const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const app=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
const admin=fs.readFileSync(path.join(__dirname,'..','public','admin.html'),'utf8');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const db=fs.readFileSync(path.join(__dirname,'..','db.js'),'utf8');

test('tester report form collects structured reproduction details and automatic context',()=>{
  for(const id of ['issueAction','issueDescription','issueExpected','issueFrequency'])assert.match(app,new RegExp(`id="${id}"`));
  assert.match(app,/page_name/);assert.match(app,/user_agent/);assert.match(app,/issueScreenshotBlob/);
  assert.match(app,/Trying to do:/);assert.match(app,/What happened:/);assert.match(app,/Expected:/);assert.match(app,/Frequency:/);
});

test('testers can see only their reports and return a retest result',()=>{
  assert.match(server,/app\.get\('\/api\/issues\/mine', requireAuth/);
  assert.match(server,/WHERE user_id=\$1 ORDER BY created_at DESC/);
  assert.match(server,/app\.post\('\/api\/issues\/:id\/retest',requireAuth/);
  assert.match(server,/id=\$4 AND user_id=\$5/);
  assert.match(app,/My Issue Reports/);assert.match(app,/Fixed on my device/);assert.match(app,/Still happening/);
});

test('ready-to-test issues carry fix details and notify the tester',()=>{
  for(const field of ['fix_summary','release_reference','retest_instructions','tester_notification_status','tester_result'])assert.match(db,new RegExp(field));
  assert.match(server,/emailIssueReadyForRetest/);
  assert.match(server,/management_status==='ready_to_test'/);
  assert.match(server,/notify-tester/);
  assert.match(admin,/What Was Fixed/);assert.match(admin,/Release or Commit/);assert.match(admin,/Retest Instructions/);assert.match(admin,/Notify Tester/);
});

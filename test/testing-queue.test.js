const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','scripts','testing-queue.js'),'utf8');
test('scheduled testing queue omits tester email addresses from its listing',()=>{assert.match(source,/SELECT i\.id,i\.description/);const listQuery=source.match(/async function list\(\)\{([\s\S]*?)async function ready/)[1];assert.doesNotMatch(listQuery,/u\.email|user_email/);});
test('queue bridge can move a repaired issue to retesting and notify its tester',()=>{assert.match(source,/management_status='ready_to_test'/);assert.match(source,/tester_notification_status/);assert.match(source,/api\.resend\.com\/emails/);});

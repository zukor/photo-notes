const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','scripts','testing-queue.js'),'utf8');
test('scheduled testing queue uses only its scoped authenticated endpoint',()=>{assert.match(source,/\/api\/automation\/testing-queue/);assert.match(source,/TESTER_QUEUE_TOKEN/);assert.doesNotMatch(source,/DATABASE_URL|new Pool/);});
test('queue bridge can move a repaired issue to retesting without contacting its tester',()=>{assert.match(source,/management_status:'ready_to_test'/);assert.match(source,/TESTER_QUEUE_TOKEN/);assert.doesNotMatch(source,/api\.resend\.com\/emails/);});

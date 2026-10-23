const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('Record Notes Self-Test shows in the account menu only for testers, testing managers and admins',()=>{
 const line=fs.readFileSync('public/app.js','utf8').split('\n').find(l=>l.includes('id="recordNotesSelfTest"'));
 assert.match(line,/state\.me\?\.is_tester\|\|state\.me\?\.is_testing_manager\|\|state\.me\?\.role==='admin'\?'':'hidden'/);
});

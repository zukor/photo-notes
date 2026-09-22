const test=require('node:test'),assert=require('node:assert/strict');
const {validFile,safeName}=require('../document-links');
test('document link uploads validate format, size and attachment filenames',()=>{
  assert.equal(validFile(Buffer.from('%PDF-1.4 fixture'),'pdf'),true);
  for(const format of ['docx','bundle'])assert.equal(validFile(Buffer.from([80,75,3,4,1]),format),true);
  for(const format of ['pdf','docx','bundle','__proto__','toString','html'])assert.equal(validFile(Buffer.from('<script>alert(1)</script>'),format),false);
  assert.equal(validFile(Buffer.alloc(21*1024*1024),'docx'),false);
  assert.equal(safeName('../secret\r\n.html','docx'),'..secret.docx');
});

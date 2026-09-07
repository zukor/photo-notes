const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(process.env.SPEECH_SOURCE||'public/issue-reporter.js','utf8');
const context={};vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function cleanSpeechTranscript'),source.indexOf('async function toggleIssueDictation')),context);
const combine=parts=>context.combineSpeechResults?context.combineSpeechResults(parts):context.cleanSpeechTranscript(parts.filter(Boolean).join(' '));
test('Android expanding result slots form one phrase in English and Spanish',()=>{
 assert.equal(combine(['this','this is','this is','this is my','this is my first test']),'this is my first test');
 assert.equal(combine(['Estoy','Estoy grabando','Estoy grabando una nota']),'Estoy grabando una nota');
});
test('distinct speech segments and deliberate emphasis remain intact',()=>{
 assert.equal(combine(['The patio is cracked.','The steps are uneven.']),'The patio is cracked. The steps are uneven.');
 assert.equal(combine(['very very important']),'very very important');
 assert.equal(combine([]),'');
});

test('Android pause boundaries do not append the same multiword tail again',()=>{
 assert.equal(combine(['La puerta es de color azul','es de color azul']),'La puerta es de color azul');
 assert.equal(combine(['La puerta es de color azul','es de color azul y está cerrada']),'La puerta es de color azul y está cerrada');
 assert.equal(combine(['La puerta','La puerta es de color azul','es de color azul']),'La puerta es de color azul');
});
test('single-result repetition and short distinct emphasis are preserved',()=>{
 assert.equal(combine(['es de color azul es de color azul']),'es de color azul es de color azul');
 assert.equal(combine(['very','very important']),'very important');
 assert.equal(combine(['yes','yes']),'yes yes');
 assert.equal(combine(['The door is blue','The window is blue']),'The door is blue The window is blue');
});

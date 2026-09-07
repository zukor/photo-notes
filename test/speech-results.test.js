const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/issue-reporter.js','utf8');
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

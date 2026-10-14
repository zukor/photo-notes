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

test('complete long sentences repeated in separate result slots appear once',()=>{
 const sentence='This is a synthetic recording to verify that a long spoken sentence is not appended again when the recognition service repeats its complete result';
 assert.ok(sentence.split(' ').length>16);
 assert.equal(combine([sentence,sentence]),sentence);
 assert.equal(context.mergeSpeechTranscript(sentence,sentence),sentence);
 assert.equal(combine([sentence,sentence+' with a new ending']),sentence+' with a new ending');
});

// Recognition may reissue the same words with sentence punctuation added.
test('punctuation revisions at indexed result and session boundaries do not duplicate long passages',()=>{
 const first='Here are three facts about this picture first a city crew is working in the street second water sprays from the pipe';
 const revised='Here are three facts about this picture. First a city crew is working in the street. Second water sprays from the pipe.';
 assert.equal(combine([first,revised+' The truck waits nearby.']),revised+' The truck waits nearby.');
 assert.equal(context.mergeSpeechTranscript(first,revised+' The truck waits nearby.'),first+' The truck waits nearby.');
 assert.equal(combine(['The door is blue.','blue and closed.']),'The door is blue. blue and closed.');
 assert.equal(combine(['Pressure is -5','Pressure is 5']),'Pressure is -5 Pressure is 5');
});

test('long expanding indexed snapshots reconcile a minor recognition revision',()=>{
 const first='In front of the building there are three rows of long white cylinders and a worker checking equipment beside another blue pie';
 const revised=first.replace('blue pie','blue pipe');
 assert.equal(combine([first,revised+' and a sign on the building']),revised+' and a sign on the building');
 const numbered='In front of the building there are 15 long white cylinders and a worker checking equipment beside another blue pipe';
 assert.equal(combine([numbered,numbered.replace('15','50')+' near the fence']),numbered+' '+numbered.replace('15','50')+' near the fence');
 const short='The blue pie';
 assert.equal(combine([short,'The blue pipe is broken']),short+' The blue pipe is broken');
 assert.equal(context.mergeSpeechTranscript(first,revised),first+' '+revised);
});

test('expanding indexed snapshot completes its truncated final word without repeating the passage',()=>{
 const first='Immediately press stop after the final sentence check the final words appears and record';
 const next='Immediately press stop after the final sentence check the final words appears and recording finish save and reopen in library';
 assert.equal(combine([first,next]),next);
 assert.equal(context.mergeSpeechTranscript(first,next),first+' '+next);
 const changed=next.replace('final words','missing words');
 assert.equal(combine([first,changed]),first+' '+changed);
 assert.equal(combine(['Please record','Please recording finish']),'Please record Please recording finish');
});

test('indexed phone-number suffix growth does not repeat the surrounding passage',()=>{
 const lead='if you see Water waste you can report it by calling ';
 const parts=['210','210-','210-704','210-704-','210-704-7','210-704-7283'].map(n=>lead+n);
 assert.equal(combine(parts),lead+'210-704-7283');
 assert.equal(combine([lead+'210',lead+'310-704-7283']),lead+'210 '+lead+'310-704-7283');
 assert.equal(context.mergeSpeechTranscript(parts[0],parts.at(-1)),parts[0]+' '+parts.at(-1));
 assert.equal(combine(['call 210','call 210-704']),'call 210 call 210-704');
});

test('short repeated openings in a new speech session are kept',()=>{
 assert.equal(context.mergeSpeechTranscript('The pipe sprays water.','Water reaches the sidewalk.'),'The pipe sprays water. Water reaches the sidewalk.');
 assert.equal(context.mergeSpeechTranscript('Look at the blue pipe.','Blue pipe needs repair.'),'Look at the blue pipe. Blue pipe needs repair.');
 assert.equal(context.mergeSpeechTranscript('very','very important'),'very very important');
 assert.equal(context.mergeSpeechTranscript('The door is blue','door is blue and closed'),'The door is blue and closed');
});


test('long expanding spelled-address snapshots preserve the latest recognized letters without repeating the passage',()=>{
 const first='rules can change with aquifer levels so residents should check s a w s. or for the current';
 const next='rules can change with aquifer levels so residents should check as a w s. or for the current stage';
 assert.equal(combine([first,next]),next);
 assert.equal(combine([first,next,next+' today']),next+' today');
 assert.equal(context.mergeSpeechTranscript(first,next),first+' '+next);
 const changed=next.replace('can change','cannot change');
 assert.equal(combine([first,changed]),first+' '+changed);
 const short='check s a w s';assert.equal(combine([short,'check as a w s today']),short+' check as a w s today');
});


test('spelled-result revisions retain negations and require a letter run and unchanged following words',()=>{
 const lead='rules can change with aquifer levels so residents should check ';
 const negation=lead+'n a w s or for the current';
 const revised=lead+'no a w s or for the current stage';
 assert.equal(combine([negation,revised]),negation+' '+revised);
 const noRun=lead+'s beside the current worker';
 const noRunNext=lead+'as beside the current worker today';
 assert.equal(combine([noRun,noRunNext]),noRun+' '+noRunNext);
 const ending=lead+'a w s';
 const endingNext=lead+'a w as today';
 assert.equal(combine([ending,endingNext]),ending+' '+endingNext);
});

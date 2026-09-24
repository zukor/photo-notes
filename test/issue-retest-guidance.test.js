const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('../public/issue-retest-guidance');
test('annotation retest checks text and shapes after reopening, without claiming a fix',()=>{
 const message=build({description:'Photo annotations disappear',reported_edition:'pro'});
 assert.match(message,/text annotation as well as an arrow or box/);assert.match(message,/reopen the same photo/);assert.match(message,/Select Photo Notes Pro/);assert.match(message,/No fix is being claimed/);assert.doesNotMatch(message,/microphone|camera access|template/);
});
test('review explanation supplies relevant user-side prerequisites without forwarding private diagnosis',()=>{
 const message=build({description:'Unable to finish',blocked_reason:'Check camera permissions. Try a stable internet connection. GitHub workflow failed with API key PRIVATE-TOKEN.',admin_notes:'Internal secret PRIVATE-LOG'});
 assert.match(message,/allowed to use the camera/);assert.match(message,/stable connection/);assert.doesNotMatch(message,/GitHub|PRIVATE|API key|workflow/);
});
test('screenshots and sharing receive different reproduction checks',()=>{
 const screenshot=build({description:'Report Issue screenshot fails on the third attempt after I send a report'});
 assert.match(screenshot,/reopen it five times/);assert.doesNotMatch(screenshot,/test recipient/);
 const sharing=build({description:'Cannot share a Word file through Teams'});assert.match(sharing,/test recipient/);assert.match(sharing,/open the exported file/);
});
test('vague reports do not invent a diagnosis or interpret clear controls as Clear search',()=>{
 const message=build({description:'I expected clear controls',blocked_reason:'The automatic repair did not pass deployment verification.'});
 assert.doesNotMatch(message,/Clear if|microphone|camera|GitHub|deployment/);assert.match(message,/steps in your original report/);assert(message.length<5000);
});
test('all relevant checks fit the submission limit even for oversized raw reports',()=>{
 const message=build({description:'crop annotation screenshot template word sharing search scan microphone broken image '.repeat(1000),blocked_reason:'camera permission and network connection'});assert(message.length<5000);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'public', 'issue-reporter.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('retired mascot and placeholder chat are absent from the app', () => {
  assert.doesNotMatch(app, /renderTensorHelp|TENSOR_HELP_TOPICS|Chat help is coming soon/);
  assert.doesNotMatch(css, /tensor-help-slot/);
});

test('new app and style versions are cache-busted', () => {
  const shell = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  for (const asset of ['styles.css', 'app.js']) {
    const url = index.match(new RegExp('/' + asset.replace('.', '\\.') + '\\?v=(\\d+)'));
    assert.ok(url && Number(url[1]) >= 175, `${asset} must retain the cache refresh`);
    assert.ok(shell.includes(url[0]), `${asset} must match the service worker cache`);
  }
});

test('Android issue-description dictation replaces revised results and restarts', () => {
  assert.match(app, /function startIssueDictationSession\(SR\)/);
  assert.match(app, /sessionText=combineSpeechResults\(parts\)/);
  assert.match(app, /mergeSpeechTranscript\(issueDictationBase,sessionText\)/);
  assert.match(app, /issueDictationRestartTimer=setTimeout\(\(\)=>startIssueDictationSession\(SR\),300\)/);
});

test('iPhone issue dictation avoids the conflicting microphone preflight and cannot hang forever', () => {
  assert.match(app, /if\(!isIOS\(\)\)try\{if\(navigator\.mediaDevices/);
  assert.match(app, /session\.interimResults=!ios/);
  assert.match(app, /issueDictationWatchdog=setTimeout/);
  assert.match(app, /No speech was received\. On iPhone/);
  assert.match(app, /if\(issueDictationActive&&!ios\)/);
});

test('Android note dictation replaces revised results and restarts after silence', () => {
  assert.match(app, /for \(let i=0;i<ev\.results\.length;i\+\+\) parts\.push/);
  assert.doesNotMatch(app, /if \(finalText\) base \+= finalText/);
  assert.match(app, /dictationRestartTimer=setTimeout\(\(\)=>startDictationSession\(SR\),300\)/);
  assert.match(app, /Listening\.\.\. tap to stop/);
  assert.match(app, /mergeSpeechTranscript\(dictationBase,sessionText\)/);
});

test('speech cleanup collapses only obvious repeated recognition fragments', () => {
  assert.match(app, /function cleanSpeechTranscript\(value\)/);
  assert.match(app, /repeats>=3/);
  assert.match(app, /function mergeSpeechTranscript\(base,incoming\)/);
});

test('Android location lookup retries and remains recoverable', () => {
  assert.match(app, /id="retryLocation">Retry location and address/);
  assert.match(app, /enableHighAccuracy:false, timeout:15000, maximumAge:60000/);
  assert.match(app, /Exact address not found\. GPS coordinates will still be saved\./);
  assert.match(app, /Tap Retry location and address, or save without an address\./);
  assert.match(app, /id="correctAddress">Correct address/);
  assert.match(app, /function correctCaptureAddress\(\)/);
});

test('opening a new issue report restores the form after a previous send', () => {
  assert.match(app, /if\(send\)\{send\.disabled=false;send\.textContent='Send Issue Report';\}/);
  assert.match(app, /if\(description\)description\.value='';/);
  assert.match(app, /if\(status\)status\.textContent='';/);
});

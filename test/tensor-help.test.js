const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('Tensor Man is Basic-only and limited to the five workflow pages', () => {
  assert.match(app, /if \(isProClient\(\) \|\| !TENSOR_HELP_TOPICS\[state\.view\]\) return/);
  for (const page of ['capture', 'organize', 'edit', 'create', 'send']) assert.match(app, new RegExp(`\\b${page}: \\[`));
  assert.doesNotMatch(app, /TENSOR_HELP_TOPICS\s*=\s*\{[\s\S]*?hoa-maintenance:/);
});

test('Tensor Man has accessible controls, secondary chat fallback, and per-page persistence', () => {
  assert.match(app, /aria-label="Help with this page"/);
  assert.match(app, /Need help with this page\?/);
  assert.match(app, /Ask Tensor Man something else/);
  assert.match(app, /Chat help is coming soon\./);
  assert.match(app, /badge\.onmouseenter = \(\) => setTensorArt\('hover'\)/);
  assert.match(app, /setTensorArt\(opening \? 'open' : 'badge'\)/);
  assert.match(app, /pn_tensor_help_hidden_\$\{page\}/);
  assert.match(app, /Hide help on this page/);
  assert.match(app, /Not now/);
});

test('Tensor Man is hidden at phone and small-tablet widths and cannot cover controls', () => {
  assert.match(css, /\.tensor-help-slot \{ min-height:44px/);
  assert.match(css, /@media \(max-width: 899px\) \{\s*\.tensor-help-slot \{ display:none; \}/);
});

test('new app and style versions are cache-busted', () => {
  assert.match(index, /styles\.css\?v=98/);
  assert.match(index, /app\.js\?v=111/);
});

test('Android issue-description dictation replaces revised results and restarts', () => {
  assert.match(app, /function startIssueDictationSession\(SR\)/);
  assert.match(app, /sessionText=parts\.filter\(Boolean\)\.join\(' '\)\.trim\(\)/);
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
});

test('Android location lookup retries and remains recoverable', () => {
  assert.match(app, /id="retryLocation">Retry location and address/);
  assert.match(app, /enableHighAccuracy:false, timeout:15000, maximumAge:60000/);
  assert.match(app, /Exact address not found\. GPS coordinates will still be saved\./);
  assert.match(app, /Tap Retry location and address, or save without an address\./);
});

test('opening a new issue report restores the form after a previous send', () => {
  assert.match(app, /if\(send\)\{send\.disabled=false;send\.textContent='Send Issue Report';\}/);
  assert.match(app, /if\(description\)description\.value='';/);
  assert.match(app, /if\(status\)status\.textContent='';/);
});

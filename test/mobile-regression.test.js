const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');

test('phone and coarse-pointer devices start in Capture', () => {
  assert.match(index, /width=device-width, initial-scale=1, viewport-fit=cover/);
  assert.match(app, /matchMedia\('\(pointer: coarse\)'\)\.matches/);
  assert.match(app, /view: IS_HANDHELD \? 'capture' : 'organize'/);
});

test('small Android widths keep header logo, tabs, and forms inside the viewport', () => {
  assert.match(css, /@media \(max-width: 380px\)/);
  assert.match(css, /grid-template-columns:auto minmax\(0,1fr\) auto/);
  assert.match(css, /\.app-header \.brandrow \.brand\.pro-edition-brand \{ width:100%; max-width:calc\(100vw - 28px\)/);
  assert.match(css, /\.workflow-tabs \{ display:grid; grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css, /\.workflow-organize #cards[\s\S]*grid-template-columns:1fr/);
});

test('the wide-browser header enlarges its brands while phone sizes stay compact', () => {
  assert.match(css, /\.app-header \.zukor-corner-logo \{[^}]*width:140px; min-width:140px/);
  assert.match(css, /@media \(min-width: 701px\)[\s\S]*\.app-header \.zukor-corner-logo \{ width:280px; min-width:280px; \}/);
  assert.match(css, /@media \(min-width: 701px\)[\s\S]*\.app-header \.brandrow \{ width:min\(750px,100%\); \}/);
  assert.match(css, /@media \(min-width: 701px\)[\s\S]*\.app-header \.brandrow \.brand\.pro-edition-brand \{ flex-basis:750px; width:750px; max-width:100%; height:90px; \}/);
  assert.match(css, /@media \(min-width: 701px\)[\s\S]*\.edition-switcher \{ grid-column:1 \/ -1; \}/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.app-header \.zukor-corner-logo \{ width:92\.5px; min-width:0; \}/);
  assert.match(css, /@media \(max-width: 380px\)[\s\S]*\.app-header \.zukor-corner-logo \{ width:78\.75px; min-width:0; \}/);
});

test('issue reporter stays recoverable and clear of primary page controls', () => {
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*\.issue-fab \{[\s\S]*position:static/);
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*\.wrap \{ padding-bottom:24px/);
  assert.match(css, /\.issue-fab \{[\s\S]*bottom:max\(14px,env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.issue-dialog \{ max-height:calc\(100vh - 20px\)/);
  assert.match(app, /send\.disabled=false;send\.textContent='Send Issue Report'/);
  assert.match(app, /fab\.disabled=false;fab\.textContent=issueFabLabel\(\)/);
});

test('Android speech revisions replace interim text instead of appending duplicates', () => {
  assert.match(app, /session\.continuous=!ios/);
  assert.match(app, /for\(let i=0;i<e\.results\.length;i\+\+\)parts\.push/);
  assert.match(app, /ta\.value=\(issueDictationBase\+sessionText\)\.trimStart\(\)/);
  assert.match(app, /noteEl\.value=\(dictationBase\+sessionText\)\.trimStart\(\)/);
});

test('late speech results cannot move from one pending photo to the next', () => {
  assert.match(app, /let dictationGeneration = 0/);
  assert.match(app, /generation!==dictationGeneration\|\|state\.photoFile!==photoForSession/);
  assert.match(app, /document\.getElementById\('note'\)!==noteEl/);
  assert.match(app, /id="dictationStatus" aria-live="polite"/);
  assert.match(app, /words may appear after you pause/);
  assert.match(app, /const replacing=!!state\.photoFile;stopCaptureDictation\(\)/);
  assert.match(app, /if\(replacing\)\{state\._note=''/);
  assert.match(app, /async function saveCapture\(\) \{\s*stopCaptureDictation\(\)/);
});

test('location failures expose a retry path without blocking photo save', () => {
  assert.match(app, /id="retryLocation"/);
  assert.match(app, /retry\.disabled = false/);
  assert.match(app, /Address lookup failed\. GPS coordinates will still be saved/);
  assert.match(app, /Location timed out or is unavailable/);
});

test('Save never waits for location and stale location cannot move to the next capture', () => {
  const saveCapture=app.slice(app.indexOf('async function saveCapture()'),app.indexOf('// ================= HOA Maintenance Pro'));
  assert.doesNotMatch(app, /Getting Full Address/);
  assert.doesNotMatch(saveCapture, /await state\._locationPromise/);
  assert.match(app, /let captureLocationGeneration = 0/);
  assert.match(app, /generation === captureLocationGeneration && state\.photoFile === photoForLocation/);
  assert.match(app, /void enqueueUpload\(payload, hadCoords\)/);
});

test('signed-in phone users receive a one-time install app icon offer', () => {
  assert.match(app, /beforeinstallprompt/);
  assert.match(app, /display-mode: standalone/);
  assert.match(app, /window\.navigator\.standalone === true/);
  assert.match(app, /pn_install_prompt_dismissed_v1/);
  assert.match(app, /Install App Icon/);
  assert.match(app, /Add to Home Screen/);
  assert.match(app, /await prompt\.prompt\(\)/);
  assert.match(css, /\.install-prompt \{/);
});

test('a newly selected capture can be retaken or cancelled before save', () => {
  assert.match(app, /id="retakePhoto">Retake Photo/);
  assert.match(app, /id="cancelPhoto">Cancel Photo/);
  assert.match(app, /function retakeCapturePhoto\(\)/);
  assert.match(app, /function cancelCapturePhoto\(\)/);
  assert.match(app, /state\.photoFile=null/);
  assert.match(css, /\.capture-preview-actions \{ display:grid; grid-template-columns:1fr 1fr/);
});

test('service-worker shell and document versions stay synchronized', () => {
  const appVersion = index.match(/app\.js\?v=(\d+)/)?.[1];
  const styleVersion = index.match(/styles\.css\?v=(\d+)/)?.[1];
  assert.ok(appVersion && styleVersion);
  assert.match(sw, new RegExp(`app\\.js\\?v=${appVersion}`));
  assert.match(sw, new RegExp(`styles\\.css\\?v=${styleVersion}`));
  assert.match(sw, new RegExp(`efc-shell-v${appVersion}`));
  assert.match(sw, /url\.pathname\.startsWith\('\/api'\)/);
  assert.match(sw, /url\.pathname\.startsWith\('\/uploads'\)/);
});

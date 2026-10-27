'use strict';
// The iPhone app's native Take Photo, Record Notes and location (public/native-capture.js),
// run against a fake Capacitor bridge and a minimal page.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const file = path.join(__dirname, '..', 'public', 'native-capture.js');

function fakeElement(id, doc) {
  const el = {
    id, value: '', textContent: '', disabled: false, attrs: {}, listeners: {}, children: [], connected: true,
    classList: { set: new Set(), toggle(name, on) { on ? this.set.add(name) : this.set.delete(name); }, contains(name) { return this.set.has(name); } },
    get isConnected() { return this.connected; },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    dispatchEvent(event) { for (const fn of this.listeners[event.type] || []) fn(event); return true; },
    after(node) { doc.nodes.set(node.id, node); node.connected = true; },
    append(node) { this.children.push(node); if (node.id) doc.nodes.set(node.id, node); },
    remove() { this.connected = false; doc.nodes.delete(this.id); },
    click() { this.onclick && this.onclick(); },
  };
  return el;
}
function fakePage() {
  const doc = { nodes: new Map(), hidden: false, listeners: {} };
  doc.getElementById = id => doc.nodes.get(id) || null;
  doc.createElement = () => fakeElement('', doc);
  doc.addEventListener = (type, fn) => { (doc.listeners[type] ||= []).push(fn); };
  for (const id of ['dictate', 'dictationStatus', 'note']) doc.nodes.set(id, fakeElement(id, doc));
  return doc;
}
// A fake native plugin: records calls and lets each test decide transcription results.
function fakeBridge({ transcribe } = {}) {
  const calls = [], listeners = {};
  const recordings = new Map();
  let active = null, counter = 0;
  const plugin = {
    addListener(name, fn) { listeners[name] = fn; return Promise.resolve({ remove() {} }); },
    async recordStart({ account, language }) { calls.push(['recordStart', account, language]); active = `00000000-0000-4000-8000-00000000000${++counter}`; recordings.set(active, { state: 'recording' }); return { id: active }; },
    async recordStop() { calls.push(['recordStop']); if (!active) throw Object.assign(Error('No recording is active.'), { code: 'idle' }); const id = active; active = null; recordings.get(id).state = 'stopped'; return { id, seconds: 130, interrupted: true }; },
    async recordStatus() { return active ? { state: 'recording', id: active, seconds: 5, level: -20 } : { state: 'idle', seconds: 0 }; },
    async transcribe({ id }) { calls.push(['transcribe', id]); return transcribe(id); },
    async markPlaced({ id }) { calls.push(['markPlaced', id]); },
    async deleteRecording({ id }) { calls.push(['deleteRecording', id]); recordings.delete(id); },
    async recordings() { return { recordings: [] }; },
    async getCurrentPosition(options) { calls.push(['getCurrentPosition', options]); return { coords: { latitude: 29.5, longitude: -98.6, accuracy: 8, altitude: null, heading: null, speed: null }, timestamp: 1000 }; },
  };
  const camera = { async getPhoto(options) { calls.push(['getPhoto', options]); return { base64String: Buffer.from('jpeg-bytes').toString('base64'), format: 'jpeg' }; } };
  const Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', nativePromise: () => Promise.reject(Error('unused')), Plugins: { PhotoNotes: plugin, Camera: camera } };
  return { Capacitor, calls, listeners };
}
function load(bridge, page, extra = {}) {
  delete require.cache[file];
  const saved = {};
  const globals = { Capacitor: bridge && bridge.Capacitor, document: page, navigator: {}, Event: class { constructor(type) { this.type = type; } }, MutationObserver: undefined, confirm: () => false, fetch: async () => ({}), atob: s => Buffer.from(s, 'base64').toString('binary'), File: class { constructor(parts, name, options) { this.parts = parts; this.name = name; this.type = options.type; } }, ...extra };
  for (const [k, v] of Object.entries(globals)) { saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); }
  const api = require(file);
  const restore = () => { for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } };
  return { api, restore, navigator: globals.navigator };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const ACCOUNT = 'a'.repeat(64);

test('in a browser the module does nothing and Save is never blocked', async () => {
  const { api, restore } = load(null, fakePage());
  try {
    assert.equal(api.enabled(), false);
    assert.equal(await api.finish(), true);
    assert.equal(await api.takePhoto(), null);
    assert.equal(api.isNativeShell({}), false);
    assert.equal(api.isNativeShell({ Capacitor: { nativePromise() {}, isNativePlatform: () => false, Plugins: { PhotoNotes: {} } } }), false);
  } finally { restore(); }
});

test('helpers format time, language, words and location', () => {
  const { api, restore } = load(null, fakePage());
  try {
    assert.equal(api.clock(0), '0:00'); assert.equal(api.clock(125), '2:05'); assert.equal(api.clock(3725), '1:02:05');
    assert.equal(api.speechLanguage('es-US'), 'es'); assert.equal(api.speechLanguage('en-US'), 'en'); assert.equal(api.speechLanguage(''), 'en');
    assert.equal(api.appendWords('Crack by the gate.', ' Needs sealing. '), 'Crack by the gate. Needs sealing.');
    assert.equal(api.appendWords('', 'First words'), 'First words');
    assert.equal(api.appendWords('Typed', ''), 'Typed');
    const p = api.toPosition({ coords: { latitude: '29.1', longitude: '-98.2', accuracy: 5, altitude: null }, timestamp: 7 });
    assert.equal(p.coords.latitude, 29.1); assert.equal(p.coords.altitude, null); assert.equal(p.timestamp, 7);
    assert.equal(api.toPositionError({ code: '1', message: 'off' }).code, 1);
    assert.equal(api.toPositionError({ code: 'x' }).code, 2);
    assert.deepEqual(api.recordingIds({ _nativeRecordings: ['00000000-0000-4000-8000-000000000001', '../etc'] }), ['00000000-0000-4000-8000-000000000001']);
  } finally { restore(); }
});

test('Record Notes records natively, adds the words from the full recording, and keeps audio until upload', async () => {
  const page = fakePage();
  const bridge = fakeBridge({ transcribe: async () => ({ text: 'Large crack near the north gate.' }) });
  const { api, restore } = load(bridge, page);
  try {
    const photo = { name: 'photo.jpg' };
    api.configure({ photo: () => photo, account: async () => ACCOUNT, language: () => 'es-US', toast() {} });
    assert.equal(api.enabled(), true);
    page.getElementById('note').value = 'Typed first.';
    await api.toggle();
    assert.deepEqual(bridge.calls[0], ['recordStart', ACCOUNT, 'es']);
    assert.equal(page.getElementById('dictate').textContent, 'Stop Recording');
    // A late status from before Stop never puts the button back into recording.
    await api.toggle();
    bridge.listeners.recordingState({ state: 'recording', seconds: 9 });
    assert.equal(await api.finish(), true);
    assert.equal(page.getElementById('note').value, 'Typed first. Large crack near the north gate.');
    assert.equal(page.getElementById('dictate').textContent, 'Record Notes');
    const id = bridge.calls.find(c => c[0] === 'recordStart') && bridge.calls.find(c => c[0] === 'markPlaced')[1];
    assert.ok(id);
    const payload = api.attach({ photo, note: 'x' });
    assert.deepEqual(payload._nativeRecordings, [id]);
    api.uploaded(payload);
    await tick();
    assert.ok(bridge.calls.some(c => c[0] === 'deleteRecording' && c[1] === id));
    // The words were added once, even though Stop and Save both waited for them.
    assert.equal(bridge.calls.filter(c => c[0] === 'markPlaced').length, 1);
  } finally { restore(); }
});

test('without a connection the recording is kept, Save asks, and Transcribe Recording adds the words later', async () => {
  const page = fakePage();
  let online = false;
  const bridge = fakeBridge({ transcribe: async () => { if (!online) throw Object.assign(Error('No connection. The recording is saved on this iPhone.'), { code: 'offline' }); return { text: 'Words after reconnecting.' }; } });
  let asked = 0;
  const { api, restore } = load(bridge, page, { confirm: () => { asked++; return false; } });
  try {
    const photo = { name: 'photo.jpg' };
    api.configure({ photo: () => photo, account: async () => ACCOUNT, language: () => 'en-US', toast() {} });
    await api.toggle();
    assert.equal(await api.finish(), false, 'Cancel keeps the capture open');
    assert.equal(asked, 1);
    assert.equal(api.keepEditing(), true, 'Save stops');
    assert.equal(api.keepEditing(), false, 'only once');
    assert.match(page.getElementById('dictationStatus').textContent, /No connection/);
    const retry = page.getElementById('dictationRetryTranscription');
    assert.ok(retry, 'Transcribe Recording is offered');
    assert.equal(retry.textContent, 'Transcribe Recording');
    online = true;
    retry.click();
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(page.getElementById('note').value, 'Words after reconnecting.');
    assert.equal(await api.finish(), true);
    // No photo recording is attached to a different capture.
    assert.equal(api.attach({ photo: { name: 'other.jpg' } })._nativeRecordings, undefined);
  } finally { restore(); }
});

test('a replaced photo ends the recording but keeps it; its words are not put into the new note', async () => {
  const page = fakePage();
  const bridge = fakeBridge({ transcribe: async () => ({ text: 'Words for the first photo.' }) });
  const { api, restore } = load(bridge, page);
  try {
    let photo = { name: 'first.jpg' };
    const toasts = [];
    api.configure({ photo: () => photo, account: async () => ACCOUNT, language: () => 'en-US', toast: m => toasts.push(m) });
    await api.toggle();
    photo = { name: 'second.jpg' };
    api.cancel('Recording stopped because the photo was replaced.');
    for (let i = 0; i < 5; i++) await tick();
    assert.ok(bridge.calls.some(c => c[0] === 'recordStop'));
    assert.equal(page.getElementById('note').value, '');
    assert.ok(!bridge.calls.some(c => c[0] === 'deleteRecording'), 'audio is kept on the iPhone');
    assert.ok(toasts.some(m => /Recordings On This iPhone/.test(m)));
  } finally { restore(); }
});

test('a recording started before the photo belongs to the photo taken during it', async () => {
  const page = fakePage();
  const bridge = fakeBridge({ transcribe: async () => ({ text: 'Spoken before the photo.' }) });
  const { api, restore } = load(bridge, page);
  try {
    let photo = null;
    api.configure({ photo: () => photo, account: async () => ACCOUNT, language: () => 'en-US', toast() {} });
    await api.toggle();
    photo = { name: 'taken-while-recording.jpg' };
    assert.equal(await api.finish(), true);
    assert.equal(page.getElementById('note').value, 'Spoken before the photo.');
  } finally { restore(); }
});

test('Take Photo uses the native camera and location uses the native plugin', async () => {
  const page = fakePage();
  const bridge = fakeBridge({ transcribe: async () => ({ text: '' }) });
  const { api, restore, navigator } = load(bridge, page);
  try {
    const photo = await api.takePhoto();
    assert.equal(photo.type, 'image/jpeg');
    assert.match(photo.name, /^photo-\d+\.jpg$/);
    const options = bridge.calls.find(c => c[0] === 'getPhoto')[1];
    assert.equal(options.source, 'CAMERA'); assert.equal(options.resultType, 'base64'); assert.equal(options.saveToGallery, false);
    const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 9000, maximumAge: 0 }));
    assert.equal(position.coords.latitude, 29.5); assert.equal(position.coords.accuracy, 8);
    assert.deepEqual(bridge.calls.find(c => c[0] === 'getCurrentPosition')[1], { enableHighAccuracy: true, timeout: 9000, maximumAge: 0 });
  } finally { restore(); }
});

test('the web app routes Take Photo, Record Notes, Save and uploads through the iPhone app', () => {
  const fs = require('node:fs');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.indexOf('/native-capture.js') > 0 && html.indexOf('/native-capture.js') < html.indexOf('/app.js'), 'loaded before app.js');
  assert.match(app, /async function toggleDictation\(\{auto=false\}=\{\}\) \{\n  if\(globalThis\.PhotoNotesNativeCapture\?\.enabled\?\.\(\)\)return auto\?undefined:globalThis\.PhotoNotesNativeCapture\.toggle\(\);/);
  // In the iPhone app the web Record Notes controls and their microphone are never set up.
  assert.match(app, /if\(globalThis\.PhotoNotesNativeCapture\?\.enabled\?\.\(\)\)\{const done=document\.getElementById\('dictationDone'\);if\(done\)done\.hidden=true;globalThis\.PhotoNotesNativeCapture\.mount\(\);\}\n  else\{/);
  const firstUse = fs.readFileSync(path.join(__dirname, '..', 'public', 'first-use.js'), 'utf8');
  assert.match(firstUse, /function offer\(me,\{force=false\}=\{\}\)\{\n[^\n]*\n[^\n]*\n  if\(window\.PhotoNotesNativeCapture\?\.enabled\?\.\(\)\)return false;/);
  assert.match(app, /function finishCaptureDictation\(\)\{[\s\S]{0,200}if\(globalThis\.PhotoNotesNativeCapture\?\.enabled\?\.\(\)\)return globalThis\.PhotoNotesNativeCapture\.finish\(\);/);
  assert.match(app, /await finishCaptureDictation\(\);\n  stopCaptureDictation\(\);\n  const note = [^\n]+\n  [^\n]*\n  if\(globalThis\.PhotoNotesNativeCapture\?\.keepEditing\?\.\(\)\)return false;/);
  assert.match(app, /PhotoNotesNativeCapture\?\.attach\?\.\(payload\);\n    try\{await enqueueUpload/);
  assert.match(app, /await queueDelete\(item\.id\);\n        globalThis\.PhotoNotesNativeCapture\?\.uploaded\?\.\(item\.payload\);/);
  assert.match(app, /function openCaptureCamera\(\)\{\n  if\(globalThis\.PhotoNotesNativeCapture\?\.enabled\?\.\(\)\)/);
});

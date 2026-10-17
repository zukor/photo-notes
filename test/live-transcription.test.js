const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const live = require('../live-transcription');

function routes(env, fetchImpl) {
  const handlers = {};
  const app = {
    get(path, ...fns) { handlers['GET ' + path] = fns; },
    post(path, ...fns) { handlers['POST ' + path] = fns; },
  };
  live.register(app, { requireAuth: (req, res, next) => next(), env, fetchImpl, logger: { warn() {} } });
  return async (method, path, req = {}) => {
    const fns = handlers[method + ' ' + path];
    const res = { statusCode: 200, body: null, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    req = { user: { id: 7 }, body: {}, query: {}, headers: {}, ...req };
    for (const fn of fns) {
      if (fn.length === 3) { await new Promise(done => fn(req, res, done)); continue; }
      await fn(req, res);
    }
    return res;
  };
}
const json = body => ({ ok: true, status: 200, json: async () => body });

test('live transcription reports unavailable without a server key and never calls the provider', async () => {
  let calls = 0;
  const call = routes({}, async () => { calls++; return json({}); });
  assert.deepEqual((await call('GET', '/api/transcription/config')).body, { live: false, provider: null });
  assert.equal((await call('POST', '/api/transcription/session')).statusCode, 503);
  assert.equal(calls, 0);
});

test('session returns a short-lived token URL and keeps the API key on the server', async () => {
  const seen = [];
  const call = routes({ ASSEMBLYAI_API_KEY: 'secret-key' }, async (url, options) => { seen.push({ url, options }); return json({ token: 'temp-token', expires_in_seconds: 60 }); });
  assert.deepEqual((await call('GET', '/api/transcription/config')).body, { live: true, provider: 'assemblyai' });
  const res = await call('POST', '/api/transcription/session', { body: { language: 'es' } });
  assert.equal(res.statusCode, 200);
  const url = new URL(res.body.url);
  assert.equal(url.host, 'streaming.assemblyai.com');
  assert.equal(url.searchParams.get('token'), 'temp-token');
  assert.equal(url.searchParams.get('speech_model'), 'universal-streaming-multilingual');
  assert.equal(url.searchParams.get('encoding'), 'pcm_s16le');
  assert.equal(url.searchParams.get('sample_rate'), '16000');
  assert.equal(url.searchParams.get('format_turns'), 'true');
  assert.ok(!res.body.url.includes('secret-key'));
  assert.match(seen[0].url, /expires_in_seconds=60/);
  assert.match(seen[0].url, /max_session_duration_seconds=900/);
  assert.equal(seen[0].options.headers.authorization, 'secret-key');
});

test('English-only model is not used for Spanish recordings', () => {
  assert.equal(live.connectionParams({ ASSEMBLYAI_STREAMING_MODEL: 'universal-streaming-english' }, 'es').speech_model, 'universal-streaming-multilingual');
  assert.equal(live.connectionParams({ ASSEMBLYAI_STREAMING_MODEL: 'nonsense' }, 'en').speech_model, 'universal-streaming-multilingual');
});

test('provider token failure returns a recoverable error, not the key or provider body', async () => {
  const call = routes({ ASSEMBLYAI_API_KEY: 'k' }, async () => ({ ok: false, status: 401, json: async () => ({ error: 'bad key k' }) }));
  const res = await call('POST', '/api/transcription/session');
  assert.equal(res.statusCode, 502);
  assert.doesNotMatch(JSON.stringify(res.body), /bad key/);
});

test('saved recording is uploaded, polled until complete, then deleted at the provider', async () => {
  const seen = []; let polls = 0;
  const fetchImpl = async (url, options = {}) => {
    seen.push([options.method || 'GET', url]);
    if (url.endsWith('/v2/upload')) return json({ upload_url: 'https://cdn/upload/1' });
    if (url.endsWith('/v2/transcript') && options.method === 'POST') { assert.equal(JSON.parse(options.body).language_code, 'es'); return json({ id: 'abc' }); }
    if (options.method === 'DELETE') return json({});
    polls++; return json(polls < 2 ? { status: 'processing' } : { status: 'completed', text: ' Hola, la grieta está aquí. ', audio_duration: 4 });
  };
  const result = await live.transcribeRecording(Buffer.alloc(100), { env: { ASSEMBLYAI_API_KEY: 'k' }, fetchImpl, lang: 'es', wait: async () => {} });
  assert.deepEqual(result, { text: 'Hola, la grieta está aquí.', seconds: 4 });
  await new Promise(r => setImmediate(r));
  assert.ok(seen.some(([m, u]) => m === 'DELETE' && u.endsWith('/v2/transcript/abc')));
});

test('limiter bounds recordings per user', () => {
  let t = 0; const allow = live.createLimiter({ limit: 2, windowMs: 1000, now: () => t });
  assert.equal(allow(1), true); assert.equal(allow(1), true); assert.equal(allow(1), false); assert.equal(allow(2), true);
  t = 2000; assert.equal(allow(1), true);
});

// ---------- Browser engine ----------
function browser({ sessionOk = true, recordingText = 'Recovered words.', recordingOk = true } = {}) {
  const sockets = [], fetches = [], timers = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.sent = []; this.readyState = 0; sockets.push(this); }
    send(data) { this.sent.push(data); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code: 1000 }); }
    open() { this.readyState = 1; this.onopen?.(); }
    message(body) { this.onmessage?.({ data: JSON.stringify(body) }); }
  }
  let processor = null;
  class FakeContext {
    constructor() { this.state = 'running'; this.sampleRate = 48000; this.destination = {}; }
    resume() { return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { processor = { connect() {}, disconnect() {}, onaudioprocess: null }; return processor; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  }
  const track = { stopped: false, listeners: {}, stop() { this.stopped = true; }, addEventListener(name, fn) { this.listeners[name] = fn; } };
  const window = {
    WebSocket: FakeSocket, AudioContext: FakeContext,
  };
  const context = {
    window, WebSocket: FakeSocket, Blob, URLSearchParams, AbortController, console,
    localStorage: { getItem: () => null, setItem() {} },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); if (ms <= 1000) return setTimeout(fn, 0); return timers.length; },
    clearTimeout: id => clearTimeout(id),
    fetch: async (url, options = {}) => {
      fetches.push({ url, options });
      if (url.startsWith('/api/transcription/config')) return json({ live: true });
      if (url.startsWith('/api/transcription/session')) return sessionOk ? json({ url: 'wss://streaming.assemblyai.com/v3/ws?token=t&format_turns=true' }) : { ok: false, status: 502, json: async () => ({}) };
      if (url.startsWith('/api/transcription/recording')) return recordingOk ? json({ text: recordingText }) : { ok: false, status: 502, json: async () => ({}) };
      throw new Error('unexpected ' + url);
    },
  };
  vm.runInNewContext(fs.readFileSync('public/live-transcription.js', 'utf8'), context);
  const api = window.PhotoNotesLiveTranscription;
  const speak = (seconds = 1) => { for (let i = 0; i < seconds * 12; i++) processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(4000).fill(0.1) } }); };
  return { api, sockets, fetches, track, speak, timers };
}
const flush = () => new Promise(r => setTimeout(r, 5));
function recorder(api) {
  const r = new api.Recognizer(); const events = []; let text = '';
  r.lang = 'en-US';
  r.onstart = () => events.push('start'); r.onend = e => events.push(e.interrupted ? 'end-interrupted' : 'end');
  r.onerror = e => events.push('error:' + e.error); r.onstatus = e => events.push('status:' + e.state);
  r.onresult = e => { text = e.results[0][0].transcript; events.push('result'); };
  return { r, events, text: () => text };
}

test('resampler converts 48 kHz to 16 kHz without losing time across blocks', () => {
  const { api } = browser();
  const resample = api._test.createResampler(48000);
  let total = 0; for (let i = 0; i < 10; i++) total += resample(new Float32Array(4800).fill(0.5)).length;
  assert.equal(total, 16000);
  const odd = api._test.createResampler(44100); let n = 0; for (let i = 0; i < 100; i++) n += odd(new Float32Array(441)).length;
  assert.ok(Math.abs(n - 16000) <= 1);
});

test('wav encoding writes a valid 16 kHz mono header', async () => {
  const { api } = browser();
  const wav = api._test.encodeWav([new Int16Array(1600), new Int16Array(800)]);
  const bytes = Buffer.from(await wav.arrayBuffer());
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  assert.equal(bytes.readUInt32LE(24), 16000); assert.equal(bytes.readUInt16LE(22), 1); assert.equal(bytes.readUInt32LE(40), 4800);
});

test('live words appear as spoken, turns stay in order, and Stop waits for final text', async () => {
  const { api, sockets, speak, track } = browser();
  await api.refresh(); assert.equal(api.enabled(), true);
  api.unlock();
  const { r, events, text } = recorder(api);
  r.start(); await flush(); await flush();
  assert.ok(events.includes('start'));
  const ws = sockets[0]; ws.open();
  speak(1);
  assert.ok(ws.sent.length >= 9, 'audio streams while recording');
  ws.message({ type: 'Turn', turn_order: 0, transcript: 'the crack is', end_of_turn: false });
  assert.equal(text(), 'the crack is');
  ws.message({ type: 'Turn', turn_order: 1, transcript: 'about two feet', end_of_turn: false });
  ws.message({ type: 'Turn', turn_order: 0, transcript: 'The crack is near the gate.', end_of_turn: true, turn_is_formatted: true });
  assert.equal(text(), 'The crack is near the gate. about two feet');
  r.stop();
  await flush();
  assert.ok(ws.sent.some(m => typeof m === 'string' && JSON.parse(m).type === 'Terminate'));
  assert.equal(events.includes('end'), false, 'does not end before final words');
  ws.message({ type: 'Turn', turn_order: 1, transcript: 'About two feet long.', end_of_turn: true, turn_is_formatted: true });
  ws.message({ type: 'Termination' });
  await flush(); await flush();
  assert.equal(text(), 'The crack is near the gate. About two feet long.');
  assert.ok(events.includes('end'));
  assert.equal(track.stopped, true, 'microphone released');
});

test('lost connection keeps recording and transcribes the saved audio after Stop', async () => {
  const { api, sockets, speak, fetches } = browser({ recordingText: 'Every word from the recording.' });
  await api.refresh(); api.unlock();
  const { r, events, text } = recorder(api);
  r.start(); await flush(); await flush();
  const ws = sockets[0]; ws.open(); speak(1);
  ws.message({ type: 'Turn', turn_order: 0, transcript: 'Every word', end_of_turn: false });
  ws.close();
  assert.ok(events.includes('status:offline'));
  speak(2);
  r.stop(); await flush(); await flush(); await flush();
  const upload = fetches.find(f => f.url.startsWith('/api/transcription/recording'));
  assert.ok(upload, 'saved recording sent for transcription');
  assert.ok(upload.options.body.size > 16000 * 2 * 2.5, 'whole recording, including audio after the drop');
  assert.equal(text(), 'Every word from the recording.');
  assert.ok(events.includes('end'));
});

test('session token failure still records and recovers words after Stop', async () => {
  const { api, sockets, speak } = browser({ sessionOk: false, recordingText: 'Offline note.' });
  await api.refresh(); api.unlock();
  const { r, events, text } = recorder(api);
  r.start(); await flush(); await flush();
  assert.equal(sockets.length, 0);
  assert.ok(events.includes('status:offline'));
  speak(2); r.stop(); await flush(); await flush(); await flush();
  assert.equal(text(), 'Offline note.');
});

test('failed transcription keeps the recording for retry instead of losing it', async () => {
  const { api, speak } = browser({ sessionOk: false, recordingOk: false });
  await api.refresh(); api.unlock();
  const { r, events } = recorder(api);
  r.start(); await flush(); await flush(); speak(2); r.stop(); await flush(); await flush(); await flush();
  assert.ok(events.includes('status:kept'));
  assert.ok(api.pendingRecording().seconds >= 1.9);
  assert.ok(events.includes('end'));
});

test('microphone taken by the phone ends as an interruption and keeps captured words', async () => {
  const { api, sockets, speak, track } = browser();
  await api.refresh(); api.unlock();
  const { r, events, text } = recorder(api);
  r.start(); await flush(); await flush();
  const ws = sockets[0]; ws.open(); speak(1);
  ws.message({ type: 'Turn', turn_order: 0, transcript: 'Kept words.', end_of_turn: true, turn_is_formatted: true });
  track.listeners.ended();
  ws.message({ type: 'Termination' }); await flush(); await flush();
  assert.equal(text(), 'Kept words.');
  assert.ok(events.includes('end-interrupted'));
});

test('abort releases the microphone and ends without further results', async () => {
  const { api, sockets, speak, track } = browser();
  await api.refresh(); api.unlock();
  const { r, events } = recorder(api);
  r.start(); await flush(); await flush();
  sockets[0].open(); speak(1); r.abort(); await flush();
  const count = events.filter(e => e === 'result').length;
  sockets[0].message({ type: 'Turn', turn_order: 0, transcript: 'late', end_of_turn: true });
  assert.equal(events.filter(e => e === 'result').length, count);
  assert.equal(track.stopped, true);
  assert.ok(events.includes('end'));
});

test('denied microphone reports not-allowed so Capture shows the permission guidance', async () => {
  const ctx = browser(); await ctx.api.refresh(); ctx.api.unlock();
  const { r, events } = recorder(ctx.api);
  r._run = async function () { const e = new Error('denied'); e.error = 'not-allowed'; throw e; };
  r.start(); await flush(); await flush();
  assert.ok(events.includes('error:not-allowed'));
});

test('Capture uses the live engine without iPhone speech-document priming and keeps audio through silence', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(app, /const SR = live \? window\.PhotoNotesLiveTranscription\.Recognizer/);
  assert.match(app, /if\(live\)\{recordDictationEvent\('live-engine'\);\}/);
  assert.match(app, /if\(live\)\{dictationWatchdog=setTimeout/);
  assert.match(app, /Number\(recognizer\.finishTimeoutMs\)\|\|8000/);
  assert.match(app, /if\(!live&&interrupted&&current&&android/);
  const html = fs.readFileSync('public/index.html', 'utf8');
  assert.ok(html.indexOf('/live-transcription.js') < html.indexOf('/app.js'));
  const sw = fs.readFileSync('public/sw.js', 'utf8');
  assert.match(sw, /\/live-transcription\.js\?v=1/); assert.match(sw, /\/pcm-capture-worklet\.js\?v=1/);
  const server = fs.readFileSync('server.js', 'utf8');
  assert.match(server, /connect-src[^"]*wss:\/\/streaming\.assemblyai\.com/);
});

test('a paused audio pipeline that captures nothing is reported instead of recording silence', async () => {
  const { api, timers } = browser();
  await api.refresh(); api.unlock();
  const { r, events } = recorder(api);
  r.start(); await flush(); await flush();
  assert.ok(events.includes('status:capture'));
  timers.find(t => t.ms === 3000).fn();
  timers.find(t => t.ms === 4000).fn();
  await flush();
  assert.ok(events.includes('error:audio-capture'));
  assert.ok(events.includes('end'));
});

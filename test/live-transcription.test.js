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
    if (url.endsWith('/v2/transcript') && options.method === 'POST') { const body = JSON.parse(options.body); assert.equal(body.language_code, 'es'); assert.ok(body.keyterms_prompt.includes('rebar')); return json({ id: 'abc' }); }
    if (options.method === 'DELETE') return json({});
    polls++; return json(polls < 2 ? { status: 'processing' } : { status: 'completed', text: ' Hola, la grieta está aquí. ', audio_duration: 4 });
  };
  const result = await live.transcribeRecording(Buffer.alloc(100), { env: { ASSEMBLYAI_API_KEY: 'k' }, fetchImpl, lang: 'es', wait: async () => {} });
  assert.deepEqual(result, { text: 'Hola, la grieta está aquí.', seconds: 4, provider: 'assemblyai' });
  await new Promise(r => setImmediate(r));
  assert.ok(seen.some(([m, u]) => m === 'DELETE' && u.endsWith('/v2/transcript/abc')));
});

test('limiter bounds recordings per user', () => {
  let t = 0; const allow = live.createLimiter({ limit: 2, windowMs: 1000, now: () => t });
  assert.equal(allow(1), true); assert.equal(allow(1), true); assert.equal(allow(1), false); assert.equal(allow(2), true);
  t = 2000; assert.equal(allow(1), true);
});

// ---------- Browser engine ----------
function browser(options = {}) {
  const opts = { sessionOk: true, recordingText: 'Recovered words.', recordingOk: true, userAgent: 'test', ...options };
  const userAgent = opts.userAgent;
  const sockets = [], fetches = [], timers = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.sent = []; this.readyState = 0; sockets.push(this); }
    send(data) { this.sent.push(data); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code: 1000 }); }
    open() { this.readyState = 1; this.onopen?.(); }
    message(body) { this.onmessage?.({ data: JSON.stringify(body) }); }
  }
  let processor = null;
  const contexts = [];
  class FakeContext {
    constructor() { this.state = 'running'; this.sampleRate = 48000; this.destination = {}; this.listeners = {}; contexts.push(this); }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    removeEventListener(name) { delete this.listeners[name]; }
    resume() { return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() { processor = { connect() {}, disconnect() {}, onaudioprocess: null }; return processor; }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  }
  const track = { stopped: false, listeners: {}, stop() { this.stopped = true; }, addEventListener(name, fn) { this.listeners[name] = fn; } };
  const listeners = {};
  const window = {
    WebSocket: FakeSocket, AudioContext: FakeContext,
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
    removeEventListener(name, fn) { listeners[name] = (listeners[name] || []).filter(f => f !== fn); },
    dispatchEvent(event) { (listeners[event.type] || []).forEach(fn => fn(event)); return true; },
  };
  const docListeners = {};
  const document = { visibilityState: 'visible', addEventListener(n, fn) { (docListeners[n] ||= []).push(fn); }, removeEventListener(n, fn) { docListeners[n] = (docListeners[n] || []).filter(f => f !== fn); }, querySelector: () => null, getElementById: () => null, hide() { this.visibilityState = 'hidden'; (docListeners.visibilitychange || []).forEach(fn => fn()); }, show() { this.visibilityState = 'visible'; (docListeners.visibilitychange || []).forEach(fn => fn()); } };
  const outcomes = [];
  const context = {
    window, document, CustomEvent: class { constructor(type) { this.type = type; } }, crypto, WebSocket: FakeSocket, Blob, URLSearchParams, AbortController, console,
    localStorage: { getItem: () => null, setItem() {} },
    navigator: { userAgent, onLine: true, mediaDevices: { getUserMedia: async () => { if (opts.micError) throw Object.assign(new Error('mic'), { name: opts.micError }); return { getTracks: () => [track], getAudioTracks: () => [track] }; } } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); if (ms <= 1000) return setTimeout(fn, 0); return timers.length; },
    clearTimeout: id => clearTimeout(id),
    fetch: async (url, options = {}) => {
      fetches.push({ url, options });
      if (url.startsWith('/api/transcription/config')) return json({ live: true });
      if (url.startsWith('/api/transcription/session')) return opts.sessionOk ? json({ url: 'wss://streaming.assemblyai.com/v3/ws?token=t&format_turns=true' }) : { ok: false, status: 502, json: async () => ({}) };
      if (url.startsWith('/api/transcription/recording')) { if (opts.recordingNetworkDown) throw new TypeError('Load failed'); return opts.recordingOk ? json({ text: opts.recordingText }) : { ok: false, status: opts.recordingStatus || 502, json: async () => ({ code: opts.recordingCode }) }; }
      if (url.startsWith('/api/transcription/outcome')) { outcomes.push(JSON.parse(options.body)); return json({ ok: true }); }
      throw new Error('unexpected ' + url);
    },
  };
  vm.runInNewContext(fs.readFileSync('public/live-transcription.js', 'utf8'), context);
  const api = window.PhotoNotesLiveTranscription;
  const speak = (seconds = 1, level = 0.1) => { for (let i = 0; i < seconds * 12; i++) processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(4000).fill(level) } }); };
  return { api, sockets, fetches, track, speak, timers, outcomes, window, document, opts, contexts, uploads: () => fetches.filter(f => f.url.startsWith('/api/transcription/recording')) };
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
  assert.match(sw, /\/live-transcription\.js\?v=\d+/); assert.match(sw, /\/pcm-capture-worklet\.js\?v=1/);
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


// ---------- Reliability additions ----------
test('custom vocabulary is sent to live sessions within provider limits', () => {
  const params = live.connectionParams({}, 'en');
  const terms = JSON.parse(params.keyterms_prompt);
  assert.ok(terms.length > 20 && terms.length <= 100);
  assert.ok(terms.every(t => t.length <= 50));
  assert.ok(terms.includes('tap record') && terms.includes('rebar'));
});

test('recording transcription retries without vocabulary if the provider rejects it', async () => {
  const bodies = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/v2/upload')) return json({ upload_url: 'u' });
    if (url.endsWith('/v2/transcript') && options.method === 'POST') { bodies.push(JSON.parse(options.body)); return bodies.length === 1 ? { ok: false, status: 400, json: async () => ({}) } : json({ id: 'x' }); }
    if (options.method === 'DELETE') return json({});
    return json({ status: 'completed', text: 'ok' });
  };
  const r = await live.transcribeRecording(Buffer.alloc(50), { env: { ASSEMBLYAI_API_KEY: 'k' }, fetchImpl, wait: async () => {} });
  assert.equal(r.text, 'ok'); assert.ok(bodies[0].keyterms_prompt); assert.equal(bodies[1].keyterms_prompt, undefined);
});

test('OpenAI is used as a backup only when AssemblyAI fails and the key exists', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => { calls.push(url); if (url.includes('assemblyai')) return { ok: false, status: 500, json: async () => ({}) }; assert.match(options.headers.authorization, /^Bearer o-key$/); return json({ text: 'Backup words.' }); };
  const r = await live.transcribeWithBackup(Buffer.alloc(50), { env: { ASSEMBLYAI_API_KEY: 'k', OPENAI_API_KEY: 'o-key' }, fetchImpl, logger: { warn() {} } });
  assert.deepEqual(r, { text: 'Backup words.', seconds: 0, provider: 'openai' });
  assert.ok(calls.some(u => u.endsWith('/audio/transcriptions')));
  await assert.rejects(live.transcribeWithBackup(Buffer.alloc(50), { env: { ASSEMBLYAI_API_KEY: 'k' }, fetchImpl }));
});

test('outcomes are validated, content-free, and device comes from the request', () => {
  assert.equal(live.outcomeDetail({ surface: 'capture', outcome: 'nonsense' }), null);
  const d = live.outcomeDetail({ surface: 'capture', outcome: 'recovered', seconds: 99999, reason: 'Closed<script>', words: 12, text: 'secret words', mode: 'installed', version: 479 }, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit Version/18 Mobile Safari/604.1');
  assert.equal(d.os, 'iPhone'); assert.equal(d.os_version, '18'); assert.equal(d.browser, 'Safari'); assert.equal(d.seconds, 3600); assert.equal(d.reason, 'closedscript'); assert.equal(d.mode, 'installed');
  assert.equal('text' in d, false);
});

test('outcome and reliability routes store and summarize without content', async () => {
  const queries = [];
  const pool = { query: async (sql, params) => { queries.push({ sql, params }); return { rows: sql.includes('GROUP BY 1 ORDER BY 2') ? [{ outcome: 'live', count: 9 }, { outcome: 'kept', count: 1 }] : [] }; } };
  const handlers = {};
  const app = { get(p, ...f) { handlers['GET ' + p] = f; }, post(p, ...f) { handlers['POST ' + p] = f; } };
  live.register(app, { requireAuth: (q, r, n) => n(), requireAdmin: (q, r, n) => n(), pool, env: {}, fetchImpl: async () => json({}), logger: { warn() {}, error() {} } });
  const run = async (key, req) => { const res = { statusCode: 200, set() { return this; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }; for (const fn of handlers[key]) { if (fn.length === 3) { let passed = false; await new Promise(d => { const json = res.json; res.json = b => { res.json = json; json.call(res, b); d(); return res; }; fn(req, res, () => { passed = true; res.json = json; d(); }); }); if (!passed) return res; } else await fn(req, res); } return res; };
  const ok = await run('POST /api/transcription/outcome', { user: { id: 3 }, body: { surface: 'feedback', outcome: 'live', seconds: 4 }, get: () => 'Android 14 Chrome/130' });
  assert.equal(ok.statusCode, 200);
  assert.match(queries[0].sql, /record_notes_outcome/); assert.equal(JSON.parse(queries[0].params[1]).os, 'Android');
  assert.equal((await run('POST /api/transcription/outcome', { user: { id: 3 }, body: { surface: 'x', outcome: 'live' }, get: () => '' })).statusCode, 400);
  const report = await run('GET /api/admin/record-notes-reliability', { user: { id: 1, role: 'admin' }, query: { days: '30' } });
  assert.equal((await run('GET /api/admin/record-notes-reliability', { user: { id: 2, role: 'user', is_testing_manager: true }, query: {} })).statusCode, 200, 'the testing manager can view reliability');
  assert.equal((await run('GET /api/admin/record-notes-reliability', { user: { id: 4, role: 'user' }, query: {} })).statusCode, 403, 'other users cannot');
  assert.deepEqual(report.body.totals, [{ outcome: 'live', count: 9 }, { outcome: 'kept', count: 1 }]);
  assert.equal(report.body.days, 30);
});

test('each recording reports one content-free outcome', async () => {
  const { api, sockets, speak, outcomes } = browser();
  await api.refresh(); api.unlock();
  const { r } = recorder(api);
  r.start(); await flush(); await flush();
  sockets[0].open(); speak(2);
  sockets[0].message({ type: 'Turn', turn_order: 0, transcript: 'Secret job words.', end_of_turn: true, turn_is_formatted: true, words: [{ end: 1500 }] });
  r.stop(); await flush(); sockets[0].message({ type: 'Termination' }); await flush(); await flush();
  assert.equal(outcomes.length, 1); assert.equal(outcomes[0].outcome, 'live'); assert.equal(outcomes[0].words, 3);
  assert.equal(JSON.stringify(outcomes).includes('Secret'), false);
});

test('a dropped connection reconnects and resends from the last confirmed audio', async () => {
  const { api, sockets, speak, outcomes, fetches } = browser({ recordingText: 'Full checked words.' });
  await api.refresh(); api.unlock();
  const { r, events, text } = recorder(api);
  r.start(); await flush(); await flush();
  sockets[0].open(); speak(3);
  // Service confirmed the first 1.2 seconds of audio before the drop.
  sockets[0].message({ type: 'Turn', turn_order: 0, transcript: 'First part.', end_of_turn: true, turn_is_formatted: true, words: [{ end: 1200 }] });
  sockets[0].message({ type: 'Turn', turn_order: 1, transcript: 'unconfirmed', end_of_turn: false });
  sockets[0].close();
  assert.ok(events.includes('status:offline'));
  assert.equal(text(), 'First part.', 'unconfirmed words are removed until resent');
  await new Promise(r => setTimeout(r, 30));
  assert.equal(sockets.length, 2, 'reconnected');
  sockets[1].open();
  const firstResent = new Int16Array(sockets[1].sent[0]);
  // 3 seconds recorded (30 chunks); 1.2 seconds confirmed (12 chunks); 18 chunks resent.
  assert.equal(sockets[1].sent.filter(m => typeof m !== 'string').length, 18, 'resends from 1.2 s, not from the start');
  assert.ok(firstResent.length === 1600);
  sockets[1].message({ type: 'Turn', turn_order: 0, transcript: 'Second part.', end_of_turn: true, turn_is_formatted: true, words: [{ end: 900 }] });
  assert.equal(text(), 'First part. Second part.');
  r.stop(); await flush(); sockets[1].message({ type: 'Termination' }); await flush(); await flush(); await flush();
  assert.ok(fetches.some(f => f.url.startsWith('/api/transcription/recording')), 'checked against the full recording after a drop');
  assert.equal(text(), 'Full checked words.');
  assert.equal(outcomes.at(-1).outcome, 'recovered'); assert.equal(outcomes.at(-1).reason, 'reconnected'); assert.equal(outcomes.at(-1).reconnects, 1);
});

test('a kept recording is retried automatically when the connection returns and routed to its screen', async () => {
  const ctx = browser({ sessionOk: false, recordingOk: false, recordingText: 'Words after reconnect.' });
  await ctx.api.refresh(); ctx.api.unlock();
  const { r, events } = recorder(ctx.api);
  r.start(); await flush(); await flush(); ctx.speak(2); r.stop(); await flush(); await flush(); await flush();
  assert.ok(events.includes('status:kept'));
  const kept = r.keptRecording; assert.ok(kept);
  let placed = '';
  ctx.api.claimKept(kept.id, t => { placed = t; return true; });
  ctx.window.dispatchEvent({ type: 'online' }); await flush(); await flush();
  assert.equal(placed, '', 'still failing service keeps it');
  assert.ok(ctx.api.pendingRecording());
  ctx.opts.recordingOk = true;
  ctx.window.dispatchEvent({ type: 'online' }); await flush(); await flush(); await flush();
  assert.equal(placed, 'Words after reconnect.');
  assert.equal(ctx.api.pendingRecording(), null);
  assert.equal(ctx.outcomes.at(-1).outcome, 'retried');
});

test('recovered words with no open screen go to the Recovered list', async () => {
  const ctx = browser({ sessionOk: false, recordingOk: false, recordingText: 'Orphan words.' });
  let recovered = 0; ctx.window.addEventListener('photonotes-recordings-recovered', () => recovered++);
  ctx.document.querySelector = () => ({}); // another dialog is open, so the list waits
  await ctx.api.refresh(); ctx.api.unlock();
  const { r } = recorder(ctx.api);
  r.start(); await flush(); await flush(); ctx.speak(2); r.stop(); await flush(); await flush(); await flush();
  ctx.api.claimKept(r.keptRecording.id, () => false); // screen already closed
  ctx.opts.recordingOk = true;
  ctx.window.dispatchEvent({ type: 'online' }); await flush(); await flush(); await flush();
  assert.equal(recovered, 1);
  const items = await ctx.api.listKept();
  assert.equal(items[0].status, 'transcribed'); assert.equal(items[0].text, 'Orphan words.');
});

test('on a phone, leaving the screen pauses recording as an interruption and keeps words', async () => {
  const ctx = browser({ userAgent: 'Mozilla/5.0 (iPhone)' });
  await ctx.api.refresh(); ctx.api.unlock();
  const { r, events, text } = recorder(ctx.api);
  r.start(); await flush(); await flush();
  ctx.sockets[0].open(); ctx.speak(1);
  ctx.sockets[0].message({ type: 'Turn', turn_order: 0, transcript: 'Before leaving.', end_of_turn: true, turn_is_formatted: true, words: [{ end: 800 }] });
  ctx.document.hide();
  ctx.sockets[0].message({ type: 'Termination' }); await flush(); await flush();
  assert.equal(text(), 'Before leaving.');
  assert.ok(events.includes('end-interrupted'));
});

test('Stop keeps audio still arriving from the microphone so the last words are sent', async () => {
  const { api, sockets, speak } = browser();
  await api.refresh(); api.unlock();
  const { r } = recorder(api);
  r.start(); await flush(); await flush();
  const ws = sockets[0]; ws.open(); speak(1);
  const before = ws.sent.length;
  r.stop();
  speak(0.5); // audio that was still in the phone's pipeline when Stop was tapped
  await flush(); await flush();
  const terminate = ws.sent.findIndex(m => typeof m === 'string' && JSON.parse(m).type === 'Terminate');
  assert.ok(terminate > before + 3, 'tail audio is streamed before Terminate');
  assert.ok(ws.sent.slice(before, terminate).every(m => typeof m !== 'string'));
});

test('after the app leaves the screen, the next recording uses a fresh audio pipeline', async () => {
  const ctx = browser({ userAgent: 'Mozilla/5.0 (iPhone)' });
  await ctx.api.refresh();
  const first = ctx.api.unlock();
  assert.equal(ctx.api.unlock(), first, 'the pipeline is reused while the app stays on screen');
  const { r, events } = recorder(ctx.api);
  r.start(); await flush(); await flush();
  ctx.sockets[0].open(); ctx.speak(1);
  ctx.document.hide();
  ctx.sockets[0].message({ type: 'Termination' }); await flush(); await flush();
  assert.ok(events.includes('end-interrupted'));
  ctx.document.visibilityState = 'visible';
  const second = ctx.api.unlock();
  assert.notEqual(second, first);
  assert.equal(first.state, 'closed', 'the stopped pipeline is released');
  assert.equal(ctx.contexts.length, 2);
  const next = recorder(ctx.api);
  next.r.start(); await flush(); await flush();
  ctx.speak(1);
  assert.ok(next.r.audioSeconds >= 0.9, 'the new recording captures audio');
});

test('Restart Recording after an interruption is not held for the browser speech engine when live recording is used', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(app, /if\(isIOS\(\)&&!liveRecordNotes\(\)&&window\.PhotoNotesSpeechDocument\)dialog\.querySelector\('#dictationRestart'\)\.disabled=/);
});

// ---------- iPhone background, fallback and outcome reasons ----------
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)';

test('leaving the screen saves the captured audio at once and ends without waiting for the network', async () => {
  const ctx = browser({ userAgent: IPHONE, recordingText: 'Before leaving the gate is cracked.' });
  await ctx.api.refresh(); ctx.api.unlock();
  const { r, events, text } = recorder(ctx.api);
  r.start(); await flush(); await flush();
  ctx.sockets[0].open(); ctx.speak(2);
  ctx.sockets[0].message({ type: 'Turn', turn_order: 0, transcript: 'Before leaving', end_of_turn: false });
  ctx.document.hide();
  await flush(); await flush();
  assert.ok(events.includes('end-interrupted'), 'ends without a Termination reply');
  assert.ok(events.includes('status:kept'), 'audio saved on the device before any network step');
  assert.ok(r.keptRecording && r.keptRecording.seconds >= 2);
  assert.equal(ctx.uploads().length, 0, 'nothing is sent while the app is off screen');
  assert.equal(ctx.outcomes.length, 0, 'the outcome waits for the result');
  assert.equal(text(), 'Before leaving', 'live words stay in the note');
  assert.equal(ctx.track.stopped, true, 'microphone released');
  // Back on screen: the saved audio is transcribed and routed to the note.
  let placed = '';
  ctx.api.claimKept(r.keptRecording.id, words => { placed = words; return true; });
  ctx.document.show();
  await new Promise(done => setTimeout(done, 20)); await flush();
  assert.equal(placed, 'Before leaving the gate is cracked.');
  assert.equal(ctx.outcomes.length, 1);
  const o = ctx.outcomes[0];
  assert.equal(o.outcome, 'recovered'); assert.equal(o.reason, 'background'); assert.equal(o.cause, 'background'); assert.equal(o.interrupted, true); assert.equal(o.words, 6);
  assert.equal(JSON.stringify(ctx.outcomes).includes('gate'), false, 'no words in outcomes');
});

test('a recording saved in the background that still cannot be transcribed reports why, then retries later', async () => {
  const ctx = browser({ userAgent: IPHONE, recordingOk: false, recordingStatus: 502, recordingCode: 'provider-timeout' });
  await ctx.api.refresh(); ctx.api.unlock();
  const { r } = recorder(ctx.api);
  r.start(); await flush(); await flush(); ctx.sockets[0].open(); ctx.speak(2);
  ctx.document.hide(); await flush(); await flush();
  ctx.document.show(); await new Promise(done => setTimeout(done, 20)); await flush();
  assert.equal(ctx.outcomes.length, 1);
  assert.equal(ctx.outcomes[0].outcome, 'kept'); assert.equal(ctx.outcomes[0].reason, 'background'); assert.equal(ctx.outcomes[0].fallback, 'upload-502-provider-timeout');
  ctx.opts.recordingOk = true; ctx.api.claimKept(r.keptRecording.id, () => true);
  ctx.window.dispatchEvent({ type: 'online' }); await flush(); await flush(); await flush();
  assert.equal(ctx.outcomes.at(-1).outcome, 'retried'); assert.equal(ctx.outcomes.at(-1).reason, 'background'); assert.equal(ctx.outcomes.at(-1).attempts, 2);
});

test('recordings are not retried while the app is off screen', async () => {
  const ctx = browser({ sessionOk: false, recordingOk: false });
  await ctx.api.refresh(); ctx.api.unlock();
  const { r } = recorder(ctx.api);
  r.start(); await flush(); await flush(); ctx.speak(2); r.stop(); await flush(); await flush(); await flush();
  const before = ctx.uploads().length;
  ctx.document.visibilityState = 'hidden';
  ctx.opts.recordingOk = true; ctx.api.claimKept(r.keptRecording.id, () => true);
  ctx.window.dispatchEvent({ type: 'online' }); await flush(); await flush();
  assert.equal(ctx.uploads().length, before);
  ctx.document.show(); await new Promise(done => setTimeout(done, 20)); await flush();
  assert.equal(ctx.uploads().length, before + 1);
});

test('the live words of a recovered recording are replaced, not repeated', () => {
  const { api } = browser();
  const swap = api._test.replaceSegment;
  assert.equal(swap('Typed first. the crack is', { anchor: 'Typed first.', segment: 'the crack is' }, 'The crack is near the gate.'), 'Typed first. The crack is near the gate.');
  assert.equal(swap('Typed first. the crack is Next part.', { anchor: 'Typed first.', segment: 'the crack is' }, 'The crack is near the gate.'), 'Typed first. The crack is near the gate. Next part.', 'words recorded after Continue Recording stay after it');
  assert.equal(swap('Typed first. Next part.', { anchor: 'Typed first.', segment: '' }, 'Recovered.'), 'Typed first. Recovered. Next part.', 'no live words: inserted where the recording was');
  assert.equal(swap('', { anchor: '', segment: '' }, 'Recovered.'), 'Recovered.');
  assert.equal(swap('Edited by hand.', { anchor: 'Typed first.', segment: 'gone' }, 'Recovered.'), 'Edited by hand. Recovered.', 'an edited note gets the words at the end');
  assert.equal(swap('Kept as is.', { segment: 'Kept' }, ''), 'Kept as is.', 'no recovered words leaves the note unchanged');
});

test('a failed check of the saved recording reports the upload status and server code', async () => {
  const ctx = browser({ sessionOk: false, recordingOk: false, recordingStatus: 429, recordingCode: 'rate-limit' });
  await ctx.api.refresh(); ctx.api.unlock();
  const { r } = recorder(ctx.api);
  r.start(); await flush(); await flush(); ctx.speak(2); r.stop(); await flush(); await flush(); await flush();
  const o = ctx.outcomes.at(-1);
  assert.equal(o.outcome, 'kept'); assert.equal(o.reason, 'token-failed'); assert.equal(o.fallback, 'upload-429-rate-limit'); assert.equal(o.mode, 'browser'); assert.equal(o.hidden, false);
  const net = browser({ sessionOk: false, recordingNetworkDown: true });
  await net.api.refresh(); net.api.unlock();
  const n = recorder(net.api);
  n.r.start(); await flush(); await flush(); net.speak(2); n.r.stop(); await flush(); await flush(); await flush();
  assert.equal(net.outcomes.at(-1).fallback, 'upload-network');
});

test('closing the screen while words are being checked keeps the recording instead of losing it', async () => {
  const ctx = browser({ sessionOk: false, recordingText: 'Checked after the screen closed.' });
  let recovered = 0; ctx.window.addEventListener('photonotes-recordings-recovered', () => recovered++);
  ctx.document.querySelector = () => ({}); // another dialog is open, so the list waits
  await ctx.api.refresh(); ctx.api.unlock();
  const { r, events } = recorder(ctx.api);
  r.start(); await flush(); await flush(); ctx.speak(2);
  r.stop(); r.abort(); // Take Photo or a new photo right after Stop
  await flush(); await flush(); await flush(); await flush();
  assert.ok(events.includes('end'));
  assert.equal(ctx.uploads().length, 1, 'the check still runs');
  assert.equal(recovered, 1, 'words go to Recovered recordings');
  assert.equal(events.filter(e => e === 'result').length, 0, 'no words are written into the closed screen');
  assert.equal(ctx.outcomes.at(-1).outcome, 'recovered'); assert.equal(ctx.outcomes.at(-1).cause, 'left-screen');
});

test('a microphone that sends no sound is reported as mic-silent and nothing is uploaded', async () => {
  const ctx = browser();
  await ctx.api.refresh(); ctx.api.unlock();
  const { r, events } = recorder(ctx.api);
  r.start(); await flush(); await flush(); ctx.sockets[0].open();
  ctx.speak(3, 0);
  ctx.timers.find(t => t.ms === 3000).fn();
  assert.ok(events.includes('status:silent'), 'warned while recording');
  r.stop(); await flush(); ctx.sockets[0].message({ type: 'Termination' }); await flush(); await flush();
  assert.equal(ctx.uploads().length, 0);
  assert.equal(ctx.outcomes.at(-1).outcome, 'failed'); assert.equal(ctx.outcomes.at(-1).reason, 'mic-silent');
});

test('a short recording with no live words is still checked against the saved audio', async () => {
  const ctx = browser({ recordingText: 'Yes.' });
  await ctx.api.refresh(); ctx.api.unlock();
  const { r, text } = recorder(ctx.api);
  r.start(); await flush(); await flush(); ctx.sockets[0].open(); ctx.speak(1);
  r.stop(); await flush(); ctx.sockets[0].message({ type: 'Termination' }); await flush(); await flush(); await flush();
  assert.equal(ctx.uploads().length, 1);
  assert.equal(text(), 'Yes.');
  assert.equal(ctx.outcomes.at(-1).outcome, 'recovered'); assert.equal(ctx.outcomes.at(-1).reason, 'no-live-text');
});

test('microphone start failures carry specific reasons', async () => {
  for (const [name, error, reason] of [['NotAllowedError', 'not-allowed', 'mic-denied'], ['NotReadableError', 'audio-capture', 'mic-notreadable']]) {
    const ctx = browser({ micError: name }); await ctx.api.refresh(); ctx.api.unlock();
    const { r, events } = recorder(ctx.api);
    r.start(); await flush(); await flush();
    assert.ok(events.includes('error:' + error));
    assert.equal(ctx.outcomes.at(-1).outcome, 'failed'); assert.equal(ctx.outcomes.at(-1).reason, reason);
  }
});

test('a phone audio interruption that does not end pauses the note and keeps the words', async () => {
  const ctx = browser({ recordingText: 'Words before the alarm.' });
  await ctx.api.refresh(); ctx.api.unlock();
  const { r, events } = recorder(ctx.api);
  r.start(); await flush(); await flush(); ctx.sockets[0].open(); ctx.speak(2);
  const audio = ctx.contexts[0];
  audio.state = 'interrupted'; audio.resume = () => Promise.resolve(); audio.listeners.statechange();
  ctx.timers.filter(t => t.ms === 1500).at(-1).fn();
  await flush(); ctx.sockets[0].message({ type: 'Termination' }); await flush(); await flush(); await flush();
  assert.ok(events.includes('end-interrupted'));
  assert.equal(r.interruption, 'audio-interrupted');
  assert.equal(ctx.outcomes.at(-1).cause, 'audio-interrupted');
});

test('saved-recording upload rejects non-WAV audio with a reason code and reports provider failures by code', async () => {
  let providerCalls = 0;
  const call = routes({ ASSEMBLYAI_API_KEY: 'k' }, async url => { providerCalls++; if (url.endsWith('/v2/upload')) return { ok: false, status: 503, json: async () => ({}) }; return json({}); });
  const notWav = await call('POST', '/api/transcription/recording', { body: Buffer.from('ftypM4A ' + ' '.repeat(80)) });
  assert.equal(notWav.statusCode, 415); assert.equal(notWav.body.code, 'unsupported-format'); assert.equal(providerCalls, 0);
  assert.equal((await call('POST', '/api/transcription/recording', { body: Buffer.alloc(10) })).body.code, 'too-small');
  const wav = Buffer.alloc(100); wav.write('RIFF', 0, 'ascii'); wav.write('WAVE', 8, 'ascii');
  const failed = await call('POST', '/api/transcription/recording', { body: wav });
  assert.equal(failed.statusCode, 502); assert.equal(failed.body.code, 'provider-upload-503');
});

test('starting recordings and checking saved recordings have separate limits', async () => {
  const handlers = {};
  const app = { get(p, ...f) { handlers['GET ' + p] = f; }, post(p, ...f) { handlers['POST ' + p] = f; } };
  live.register(app, { requireAuth: (q, r, n) => n(), env: { ASSEMBLYAI_API_KEY: 'k' }, recordingLimiter: () => false, fetchImpl: async () => json({ token: 't' }), logger: { warn() {} } });
  const run = async (key, req) => { const res = { statusCode: 200, set() { return this; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }; for (const fn of handlers[key]) { if (fn.length === 3) { await new Promise(d => fn(req, res, d)); continue; } await fn(req, res); } return res; };
  const wav = Buffer.alloc(100); wav.write('RIFF', 0, 'ascii'); wav.write('WAVE', 8, 'ascii');
  const busy = await run('POST /api/transcription/recording', { user: { id: 1 }, body: wav, query: {}, headers: {} });
  assert.equal(busy.statusCode, 429); assert.equal(busy.body.code, 'rate-limit');
  assert.equal((await run('POST /api/transcription/session', { user: { id: 1 }, body: {}, query: {}, headers: {} })).statusCode, 200, 'a new recording can still start');
});

test('outcomes keep cause, fallback, wake lock and app state codes, and tell iPad from Mac', () => {
  const d = live.outcomeDetail({ surface: 'capture', outcome: 'kept', reason: 'background', cause: 'background', fallback: 'upload-502-provider-upload-500+backup-5', wake: 'failed', attempts: 3, hidden: true, restored: true, touch: true, mode: 'installed' }, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Version/18 Safari/605.1.15');
  assert.equal(d.os, 'iPad'); assert.equal(d.cause, 'background'); assert.equal(d.fallback, 'upload-502-provider-upload-500+backup-5'); assert.equal(d.wake, 'failed');
  assert.equal(d.attempts, 3); assert.equal(d.hidden, true); assert.equal(d.restored, true); assert.equal(d.mode, 'installed');
  assert.equal(live.outcomeDetail({ surface: 'capture', outcome: 'live' }, 'Mozilla/5.0 (Macintosh) Safari/605').os, 'Mac');
});

test('reliability report lists reasons per device and does not count later transcriptions as new recordings', async () => {
  const queries = [];
  const pool = { query: async sql => { queries.push(sql); return { rows: [] }; } };
  const handlers = {};
  const app = { get(p, ...f) { handlers['GET ' + p] = f; }, post(p, ...f) { handlers['POST ' + p] = f; } };
  live.register(app, { requireAuth: (q, r, n) => n(), pool, env: {}, fetchImpl: async () => json({}), logger: { warn() {}, error() {} } });
  const res = { set() { return this; }, status() { return this; }, json(b) { this.body = b; return this; } };
  const fns = handlers['GET /api/admin/record-notes-reliability'];
  await new Promise(done => fns[0]({ user: { role: 'admin' }, query: {} }, res, done));
  await fns[1]({ user: { role: 'admin' }, query: {} }, res);
  assert.ok(Array.isArray(res.body.reasons));
  const devices = queries.find(q => q.includes('transcribed_later'));
  assert.match(devices, /FILTER \(WHERE e\.detail->>'outcome'<>'retried'\)::int recordings/);
  assert.ok(queries.some(q => q.includes("e.detail->>'fallback'") && q.includes("e.detail->>'cause'")));
  const page = fs.readFileSync('public/admin-record-notes.js', 'utf8');
  assert.match(page, /Reasons by device/); assert.match(page, /Why not transcribed/); assert.match(page, /Transcribed later/);
});

test('Capture shows a plain pause message with Continue Recording and replaces live words with checked words', () => {
  const ctx = browser();
  assert.match(ctx.api.pauseMessage('background'), /^Recording paused because PhotoNotes left the screen\. Phones do not let web apps record in the background\. Your words so far are saved\. Tap Continue Recording to keep going\.$/);
  assert.match(ctx.api.pauseMessage('mic-ended'), /call, Siri or an alarm/);
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(app, /id="dictationRestart" type="button">Continue Recording<\/button>/);
  assert.match(app, /showDictationInterruption\(window\.PhotoNotesLiveTranscription\?\.pauseMessage\?\.\(endEvent\.reason\)[^;]*\{paused:true\}\)/);
  assert.match(app, /live\.replaceSegment\(value,where,text,mergeSpeechTranscript\)/);
  assert.match(app, /if\(dictationActive&&dictationBase\)\{dictationBase=swap\(dictationBase\)/);
  for (const text of ['Recording paused', 'Continue Recording', ctx.api.pauseMessage('background'), ctx.api.messages.backgroundSaved, ctx.api.messages.silent]) assert.ok(/[—]/.test(text) === false, 'no em dashes');
  const i18n = fs.readFileSync('public/i18n.js', 'utf8');
  for (const text of ['Recording paused', 'Continue Recording', ctx.api.pauseMessage('background'), ctx.api.pauseMessage('mic-ended'), ctx.api.messages.backgroundSaved, ctx.api.messages.silent]) assert.ok(i18n.includes(JSON.stringify(text)), 'Spanish for: ' + text);
});

test('iPhone app recordings are reported as the iPhone app in native mode', () => {
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 PhotoNotesAI-iOS/1';
  const d = live.outcomeDetail({ surface: 'capture', outcome: 'live', mode: 'native', interrupted: true, seconds: 125 }, ua);
  assert.equal(d.os, 'iPhone'); assert.equal(d.browser, 'iPhone app'); assert.equal(d.mode, 'native'); assert.equal(d.interrupted, true); assert.equal(d.seconds, 125);
  assert.equal(live.outcomeDetail({ surface: 'capture', outcome: 'live', mode: 'other' }, ua).mode, 'browser');
});

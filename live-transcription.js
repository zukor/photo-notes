'use strict';
// Live Record Notes transcription through AssemblyAI streaming.
// The API key stays on the server. Browsers receive a short-lived token and
// stream microphone audio directly to AssemblyAI. A recorded copy of the audio
// stays in the browser; when streaming fails it is sent here once for
// after-the-fact transcription (AssemblyAI, then OpenAI as a backup when that
// key exists). Audio is never written to PhotoNotes storage.
// Each recording also reports a content-free outcome so reliability can be measured.
const express = require('express');

const STREAMING_HOST = 'streaming.assemblyai.com';
const API_BASE = 'https://api.assemblyai.com';
const OPENAI_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'universal-streaming-multilingual';
const MODELS = new Set(['universal-streaming-multilingual', 'universal-streaming-english', 'universal-3-6-pro']);
const MAX_SESSION_SECONDS = 900; // 15 minutes per note bounds runaway billing.
const MAX_BATCH_BYTES = 40 * 1024 * 1024; // About 20 minutes of 16 kHz mono PCM.

// Vocabulary the transcription service should favor. Each term is at most 50
// characters and the list stays under the 100-term streaming limit.
const KEYTERMS = Object.freeze([
  'PhotoNotes', 'Photo Notes', 'Record Notes', 'tap record', 'tab record', 'Zukor', 'Capture', 'Library', 'Send Feedback', 'Report Issue',
  'rebar', 'wire mesh', 'formwork', 'slab', 'slab on grade', 'footing', 'foundation', 'driveway', 'sidewalk', 'patio', 'curb', 'gutter',
  'curb and gutter', 'retaining wall', 'expansion joint', 'control joint', 'saw cut', 'broom finish', 'stamped concrete', 'flatwork',
  'cubic yards', 'square feet', 'linear feet', 'PSI', 'compaction', 'base course', 'subgrade', 'asphalt', 'sealcoat', 'crack sealing',
  'pothole', 'milling', 'overlay', 'tack coat', 'striping', 'ADA ramp', 'parking lot', 'dumpster pad', 'drainage', 'storm drain',
  'irrigation', 'landscaping', 'HOA', 'common area', 'change order', 'punch list', 'general contractor', 'subcontractor', 'scope of work',
  'extra work', 'delivery ticket', 'batch ticket', 'spalling', 'efflorescence', 'settlement', 'trip hazard', 'roof', 'shingles', 'flashing',
  'gate', 'perimeter fence', 'inspection', 'work order', 'before and after', 'gps', 'dot com', 'dot org',
]);

const SURFACES = new Set(['capture', 'feedback', 'issue', 'ewr', 'selftest']);
const OUTCOMES = new Set(['live', 'recovered', 'kept', 'retried', 'failed', 'empty', 'cancelled', 'interrupted']);

function apiKey(env = process.env) { return String(env.ASSEMBLYAI_API_KEY || '').trim(); }
function openaiKey(env = process.env) { return String(env.OPENAI_API_KEY || '').trim(); }
function configured(env = process.env) { return !!apiKey(env) && env.LIVE_TRANSCRIPTION_DISABLED !== '1'; }
function streamingModel(env = process.env) { const m = String(env.ASSEMBLYAI_STREAMING_MODEL || '').trim(); return MODELS.has(m) ? m : DEFAULT_MODEL; }
function language(value) { return String(value || '').toLowerCase().startsWith('es') ? 'es' : 'en'; }

function connectionParams(env = process.env, lang = 'en') {
  const model = streamingModel(env);
  const params = { speech_model: model, encoding: 'pcm_s16le', sample_rate: '16000', keyterms_prompt: JSON.stringify(KEYTERMS) };
  // Universal Streaming returns punctuated, capitalized final turns only when asked.
  if (model !== 'universal-3-6-pro') params.format_turns = 'true';
  // The English-only model cannot transcribe Spanish; fall back to multilingual.
  if (model === 'universal-streaming-english' && lang === 'es') params.speech_model = DEFAULT_MODEL;
  return params;
}

// Per-user limiter so a stuck client cannot open sessions in a loop.
function createLimiter({ limit = 30, windowMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
  const hits = new Map();
  return userId => {
    const t = now(), list = (hits.get(userId) || []).filter(at => t - at < windowMs);
    if (list.length >= limit) { hits.set(userId, list); return false; }
    list.push(t); hits.set(userId, list); return true;
  };
}

async function requestToken({ env = process.env, fetchImpl = fetch } = {}) {
  const url = `https://${STREAMING_HOST}/v3/token?expires_in_seconds=60&max_session_duration_seconds=${MAX_SESSION_SECONDS}`;
  const r = await fetchImpl(url, { headers: { authorization: apiKey(env) } });
  if (!r.ok) { const error = new Error('token request failed'); error.status = r.status; throw error; }
  const body = await r.json();
  if (!body || typeof body.token !== 'string' || !body.token) throw new Error('token missing');
  return body.token;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function transcribeRecording(buffer, { env = process.env, fetchImpl = fetch, lang = 'en', pollMs = 1000, timeoutMs = 90000, wait = sleep } = {}) {
  const key = apiKey(env);
  const upload = await fetchImpl(`${API_BASE}/v2/upload`, { method: 'POST', headers: { authorization: key, 'content-type': 'application/octet-stream' }, body: buffer });
  if (!upload.ok) throw new Error('upload failed');
  const { upload_url: audioUrl } = await upload.json();
  if (!audioUrl) throw new Error('upload url missing');
  const request = body => fetchImpl(`${API_BASE}/v2/transcript`, { method: 'POST', headers: { authorization: key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const base = { audio_url: audioUrl, language_code: lang, punctuate: true, format_text: true };
  // Prefer custom vocabulary; if the provider rejects it, transcribe without it.
  let create = await request({ ...base, keyterms_prompt: KEYTERMS });
  if (!create.ok && create.status === 400) create = await request(base);
  if (!create.ok) throw new Error('transcript request failed');
  const job = await create.json();
  if (!job || !job.id) throw new Error('transcript id missing');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const poll = await fetchImpl(`${API_BASE}/v2/transcript/${encodeURIComponent(job.id)}`, { headers: { authorization: key } });
    if (!poll.ok) throw new Error('transcript status failed');
    const status = await poll.json();
    if (status.status === 'completed') {
      // Remove the provider's copy of the transcript and audio once text is returned.
      fetchImpl(`${API_BASE}/v2/transcript/${encodeURIComponent(job.id)}`, { method: 'DELETE', headers: { authorization: key } }).catch(() => {});
      return { text: String(status.text || '').trim(), seconds: Number(status.audio_duration) || 0, provider: 'assemblyai' };
    }
    if (status.status === 'error') throw new Error('transcription error');
    if (Date.now() > deadline) throw new Error('transcription timed out');
    await wait(pollMs);
  }
}

// Backup transcription when AssemblyAI is unavailable. Uses the existing OpenAI key.
async function transcribeWithOpenAI(buffer, { env = process.env, fetchImpl = fetch, lang = 'en' } = {}) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'audio/wav' }), 'recording.wav');
  form.append('model', String(env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe'));
  form.append('language', lang);
  form.append('prompt', 'Field notes about construction, paving, concrete and property maintenance. Terms: ' + KEYTERMS.slice(9, 60).join(', ') + '.');
  const r = await fetchImpl(`${OPENAI_BASE}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${openaiKey(env)}` }, body: form });
  if (!r.ok) throw new Error('backup transcription failed');
  const body = await r.json();
  return { text: String(body.text || '').trim(), seconds: 0, provider: 'openai' };
}

async function transcribeWithBackup(buffer, options = {}) {
  const env = options.env || process.env;
  try { return await transcribeRecording(buffer, options); }
  catch (primary) {
    if (!openaiKey(env)) throw primary;
    options.logger?.warn?.('[live-transcription] primary transcription failed, using backup', primary.message);
    return transcribeWithOpenAI(buffer, options);
  }
}

// Device summary from the request, so the browser cannot report misleading values.
function deviceFrom(userAgent = '') {
  const ua = String(userAgent);
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Other';
  const browser = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const version = (ua.match(/OS (\d+)[_.]\d/) || ua.match(/Android (\d+)/) || [])[1] || '';
  return { os, browser, os_version: version };
}

function outcomeDetail(body = {}, userAgent = '') {
  const b = body || {};
  if (!SURFACES.has(b.surface) || !OUTCOMES.has(b.outcome)) return null;
  const clamp = (n, max) => Math.max(0, Math.min(max, Math.round(Number(n) || 0)));
  const code = s => String(s || '').toLowerCase().replace(/[^a-z0-9:_-]/g, '').slice(0, 40);
  return {
    surface: b.surface, outcome: b.outcome, ...deviceFrom(userAgent),
    mode: b.mode === 'installed' ? 'installed' : 'browser',
    version: clamp(b.version, 100000), seconds: clamp(b.seconds, 3600), reconnects: clamp(b.reconnects, 20),
    words: clamp(b.words, 100000), reason: code(b.reason), interrupted: b.interrupted === true,
  };
}

function register(app, { requireAuth, requireAdmin, pool, env = process.env, fetchImpl = fetch, limiter = createLimiter(), logger = console } = {}) {
  app.get('/api/transcription/config', requireAuth, (req, res) => {
    res.set('Cache-Control', 'no-store').json({ live: configured(env), provider: configured(env) ? 'assemblyai' : null });
  });
  app.post('/api/transcription/session', requireAuth, async (req, res) => {
    if (!configured(env)) return res.status(503).json({ error: 'Live transcription is not configured' });
    if (!limiter(req.user.id)) return res.status(429).json({ error: 'Too many recordings started. Wait a few minutes and try again.' });
    try {
      const token = await requestToken({ env, fetchImpl });
      const params = new URLSearchParams({ ...connectionParams(env, language(req.body && req.body.language)), token });
      res.set('Cache-Control', 'no-store').json({ url: `wss://${STREAMING_HOST}/v3/ws?${params}`, sampleRate: 16000 });
    } catch (error) {
      logger.warn?.('[live-transcription] session token failed', error.status || error.message);
      res.status(502).json({ error: 'Live transcription is unavailable right now' });
    }
  });
  app.post('/api/transcription/recording', requireAuth, express.raw({ type: ['audio/wav', 'application/octet-stream'], limit: MAX_BATCH_BYTES }), async (req, res) => {
    if (!configured(env)) return res.status(503).json({ error: 'Transcription is not configured' });
    if (!Buffer.isBuffer(req.body) || req.body.length < 44) return res.status(400).json({ error: 'Recording missing' });
    if (!limiter(req.user.id)) return res.status(429).json({ error: 'Too many recordings. Wait a few minutes and try again.' });
    try {
      const result = await transcribeWithBackup(req.body, { env, fetchImpl, lang: language(req.query.language), logger });
      res.set('Cache-Control', 'no-store').json(result);
    } catch (error) {
      logger.warn?.('[live-transcription] recording transcription failed', error.message);
      res.status(502).json({ error: 'The recording could not be transcribed right now' });
    }
  });
  if (!pool) return;
  app.post('/api/transcription/outcome', requireAuth, async (req, res) => {
    const detail = outcomeDetail(req.body, req.get('user-agent'));
    if (!detail) return res.status(400).json({ error: 'Invalid outcome' });
    try { await pool.query(`INSERT INTO events(user_id,action,detail) VALUES($1,'record_notes_outcome',$2)`, [req.user.id, JSON.stringify(detail)]); res.json({ ok: true }); }
    catch { res.status(503).json({ error: 'Outcome unavailable' }); }
  });
  // Admins and the testing manager can review reliability. Results never contain words or audio.
  const requireReliabilityViewer = (req, res, next) => requireAuth(req, res, () =>
    req.user && (req.user.role === 'admin' || req.user.is_testing_manager === true) ? next() : res.status(403).json({ error: 'Admin or testing manager access required' }));
  app.get('/api/admin/record-notes-reliability', requireReliabilityViewer, async (req, res) => {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
    const where = `e.action='record_notes_outcome' AND e.created_at >= now()-($1::int*interval '1 day')`;
    try {
      const totals = (await pool.query(`SELECT e.detail->>'outcome' outcome,COUNT(*)::int count FROM events e WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`, [days])).rows;
      const devices = (await pool.query(`SELECT e.detail->>'os' os,e.detail->>'browser' browser,e.detail->>'mode' mode,COUNT(*)::int recordings,
        COUNT(*) FILTER (WHERE e.detail->>'outcome' IN ('live','recovered','retried'))::int succeeded,
        COUNT(*) FILTER (WHERE e.detail->>'outcome'='recovered')::int recovered,
        COUNT(*) FILTER (WHERE e.detail->>'outcome' IN ('kept','failed'))::int not_transcribed,
        COUNT(*) FILTER (WHERE (e.detail->>'interrupted')::boolean)::int interrupted
        FROM events e WHERE ${where} AND e.detail->>'outcome' NOT IN ('cancelled','empty') GROUP BY 1,2,3 ORDER BY recordings DESC`, [days])).rows;
      const versions = (await pool.query(`SELECT e.detail->>'version' version,COUNT(*)::int recordings,COUNT(*) FILTER (WHERE e.detail->>'outcome' IN ('kept','failed'))::int not_transcribed FROM events e WHERE ${where} AND e.detail->>'outcome' NOT IN ('cancelled','empty') GROUP BY 1 ORDER BY 1 DESC LIMIT 20`, [days])).rows;
      const problems = (await pool.query(`SELECT e.created_at,u.name,u.email,e.detail FROM events e LEFT JOIN users u ON u.id=e.user_id WHERE ${where} AND e.detail->>'outcome' IN ('recovered','kept','failed','interrupted') ORDER BY e.created_at DESC LIMIT 50`, [days])).rows;
      res.set('Cache-Control', 'no-store').json({ days, totals, devices, versions, problems });
    } catch (e) { logger.error?.('[live-transcription] reliability', e); res.status(500).json({ error: 'Reliability could not be loaded' }); }
  });
}

module.exports = { register, configured, connectionParams, requestToken, transcribeRecording, transcribeWithOpenAI, transcribeWithBackup, outcomeDetail, deviceFrom, createLimiter, streamingModel, KEYTERMS, STREAMING_HOST, MAX_SESSION_SECONDS };

'use strict';
// Live Record Notes transcription through AssemblyAI streaming.
// The API key stays on the server. Browsers receive a short-lived token and
// stream microphone audio directly to AssemblyAI. A recorded copy of the audio
// stays in the browser; when streaming fails it is sent here once for
// after-the-fact transcription. Audio is never written to PhotoNotes storage.
const express = require('express');

const STREAMING_HOST = 'streaming.assemblyai.com';
const API_BASE = 'https://api.assemblyai.com';
const DEFAULT_MODEL = 'universal-streaming-multilingual';
const MODELS = new Set(['universal-streaming-multilingual', 'universal-streaming-english', 'universal-3-6-pro']);
const MAX_SESSION_SECONDS = 900; // 15 minutes per note bounds runaway billing.
const MAX_BATCH_BYTES = 40 * 1024 * 1024; // About 20 minutes of 16 kHz mono PCM.

function apiKey(env = process.env) { return String(env.ASSEMBLYAI_API_KEY || '').trim(); }
function configured(env = process.env) { return !!apiKey(env) && env.LIVE_TRANSCRIPTION_DISABLED !== '1'; }
function streamingModel(env = process.env) { const m = String(env.ASSEMBLYAI_STREAMING_MODEL || '').trim(); return MODELS.has(m) ? m : DEFAULT_MODEL; }
function language(value) { return String(value || '').toLowerCase().startsWith('es') ? 'es' : 'en'; }

function connectionParams(env = process.env, lang = 'en') {
  const model = streamingModel(env);
  const params = { speech_model: model, encoding: 'pcm_s16le', sample_rate: '16000' };
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
  const create = await fetchImpl(`${API_BASE}/v2/transcript`, { method: 'POST', headers: { authorization: key, 'content-type': 'application/json' }, body: JSON.stringify({ audio_url: audioUrl, language_code: lang, punctuate: true, format_text: true }) });
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
      return { text: String(status.text || '').trim(), seconds: Number(status.audio_duration) || 0 };
    }
    if (status.status === 'error') throw new Error('transcription error');
    if (Date.now() > deadline) throw new Error('transcription timed out');
    await wait(pollMs);
  }
}

function register(app, { requireAuth, env = process.env, fetchImpl = fetch, limiter = createLimiter(), logger = console } = {}) {
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
      const result = await transcribeRecording(req.body, { env, fetchImpl, lang: language(req.query.language) });
      res.set('Cache-Control', 'no-store').json(result);
    } catch (error) {
      logger.warn?.('[live-transcription] recording transcription failed', error.message);
      res.status(502).json({ error: 'The recording could not be transcribed right now' });
    }
  });
}

module.exports = { register, configured, connectionParams, requestToken, transcribeRecording, createLimiter, streamingModel, STREAMING_HOST, MAX_SESSION_SECONDS };

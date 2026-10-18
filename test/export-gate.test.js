const test = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const { createExportGate } = require('../export-gate');
function response() { const r = new EventEmitter(); r.headers = {}; r.set = (k, v) => { r.headers[k] = v; return r; }; r.status = c => { r.statusCode = c; return r; }; r.json = b => { r.body = b; r.writableEnded = true; return r; }; return r; }
function timers() { const list = []; return { list, setTimer: (fn) => { const t = { fn }; list.push(t); return t; }, clearTimer: t => { t.cleared = true; } }; }

test('only the allowed number of exports run at once; the next starts when one finishes', () => {
  const t = timers(), gate = createExportGate({ max: 2, ...t }), started = [], res = [response(), response(), response()];
  res.forEach((r, i) => gate.middleware({}, r, () => started.push(i)));
  assert.deepEqual(started, [0, 1]); assert.deepEqual(gate.stats(), { running: 2, waiting: 1, max: 2 });
  res[0].emit('finish'); res[0].emit('close');
  assert.deepEqual(started, [0, 1, 2]); assert.equal(gate.stats().running, 2);
  res[1].emit('finish'); res[2].emit('close');
  assert.equal(gate.stats().running, 0);
});

test('a full line or a long wait gets a clear try-again message', () => {
  const t = timers(), gate = createExportGate({ max: 1, queueLimit: 1, ...t });
  gate.middleware({}, response(), () => {});
  const queued = response(), refused = response();
  gate.middleware({}, queued, () => assert.fail('should wait'));
  gate.middleware({}, refused, () => assert.fail('line is full'));
  assert.equal(refused.statusCode, 503); assert.equal(refused.headers['Retry-After'], '30');
  t.list[0].fn();
  assert.equal(queued.statusCode, 503); assert.equal(gate.stats().waiting, 0);
});

test('someone who leaves while waiting gives up their place', () => {
  const t = timers(), gate = createExportGate({ max: 1, ...t }), first = response(), leaver = response(), next = response();
  let nextStarted = false;
  gate.middleware({}, first, () => {});
  gate.middleware({}, leaver, () => assert.fail('left before starting'));
  gate.middleware({}, next, () => { nextStarted = true; });
  leaver.emit('close');
  assert.equal(gate.stats().waiting, 1);
  first.emit('finish');
  assert.equal(nextStarted, true);
});

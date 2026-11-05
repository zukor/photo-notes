const test=require('node:test');
const assert=require('node:assert/strict');
const tf=require('../time-format');

function req(headers={},query={}){return {query,get:name=>headers[name]||''};}

test('zone and language come from the request, with safe fallbacks',()=>{
  assert.equal(tf.zoneFrom(req({'x-pn-tz':'America/Chicago'})),'America/Chicago');
  assert.equal(tf.zoneFrom(req({'x-pn-tz':'Not/AZone'})),tf.DEFAULT_ZONE);
  assert.equal(tf.zoneFrom(req({},{tz:'America/New_York'})),'America/New_York');
  assert.equal(tf.languageFrom(req({'x-pn-lang':'es'})),'es');
  assert.equal(tf.languageFrom(req({},{lang:'es-MX'})),'es');
  assert.equal(tf.languageFrom(req()),'en');
});

test('instants are printed in the person\'s zone, not the server clock',()=>{
  const chicago=req({'x-pn-tz':'America/Chicago'});
  assert.equal(tf.formatDateTime('2026-11-04T01:30:00Z',chicago),'11/3/2026, 7:30 PM');
  assert.equal(tf.formatDate('2026-11-04T01:30:00Z',chicago),'11/3/2026');
  assert.equal(tf.formatTime('2026-11-04T01:30:00Z',chicago),'7:30 PM');
  assert.equal(tf.localDateKey('2026-11-04T01:30:00Z',chicago),'2026-11-03');
  assert.match(tf.formatDateTimeZone('2026-11-04T01:30:00Z',{zone:'America/Chicago',language:'en'}),/Nov 3, 2026, 7:30 PM CST/);
});

test('calendar dates stay on their day in every zone',()=>{
  assert.equal(tf.formatDate('2026-11-05',req({'x-pn-tz':'Pacific/Auckland'})),'11/5/2026');
  assert.equal(tf.formatDate('2026-11-05',req({'x-pn-tz':'America/Los_Angeles'})),'11/5/2026');
});

test('Spanish uses Spanish formatting and empty input prints nothing',()=>{
  assert.match(tf.formatLongDate('2026-11-04T01:30:00Z',req({'x-pn-tz':'America/Chicago','x-pn-lang':'es'})),/3 de noviembre de 2026/);
  assert.equal(tf.formatDate(null),'');
  assert.equal(tf.formatDateTime('not a date'),'');
});

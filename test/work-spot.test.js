const test = require('node:test'), assert = require('node:assert/strict');
const W = require('../public/work-spot.js');

test('distance and direction back to the photo spot', () => {
  const here = { lat: 29.4232, lng: -98.4936 }, spot = { lat: 29.4241, lng: -98.4936 };
  const d = W.distanceBearing(here, spot);
  assert.ok(Math.abs(d.meters - 100) < 1, String(d.meters));
  assert.ok(Math.abs(d.feet - 328) < 3);
  assert.equal(W.compassName(d.bearing), 'north');
  assert.equal(W.compassName(W.distanceBearing(spot, here).bearing), 'south');
  assert.equal(W.compassName(44), 'northeast'); assert.equal(W.compassName(359), 'north'); assert.equal(W.compassName(-90), 'west');
});

test('distances read in feet nearby and miles far away', () => {
  assert.equal(W.formatDistance(42.4), '42 ft');
  assert.equal(W.formatDistance(328), '330 ft');
  assert.equal(W.formatDistance(2640), '0.5 miles');
  assert.equal(W.formatDistance(100000), '19 miles');
});

test('arrival allows for GPS uncertainty, at least 25 ft', () => {
  assert.equal(W.arrivedFeet(null, null), 25);
  assert.ok(W.arrivedFeet(10, 10) > 45);
});

test('directions use Apple Maps on Apple devices, Google elsewhere, and the address when there is no GPS', () => {
  const t = { lat: 29.4241, lng: -98.4936 };
  assert.equal(W.directionsUrl(t, null, 'iPhone'), 'https://maps.apple.com/?daddr=29.4241,-98.4936&dirflg=d');
  assert.equal(W.directionsUrl(t, null, 'Android'), 'https://www.google.com/maps/dir/?api=1&destination=29.4241,-98.4936');
  assert.equal(W.directionsUrl(null, '100 Commerce St', 'Android'), 'https://www.google.com/maps/dir/?api=1&destination=100%20Commerce%20St');
  assert.equal(W.directionsUrl(null, null, 'Android'), null);
});

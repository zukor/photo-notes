const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('street-address reverse geocoding is limited to a nearby mapped point', () => {
  assert.match(server, /const MAX_ADDRESS_DISTANCE_METERS = 35/);
  assert.match(server, /function geocodeCandidateIsNearby\(lat, lng, candidateLat, candidateLng\)/);
  assert.match(server, /haversineMeters\(lat, lng, candidateLat, candidateLng\)/);
  assert.match(server, /geocodeCandidateIsNearby\(lat, lng, match\.y, match\.x\)/);
  assert.match(server, /geocodeCandidateIsNearby\(lat, lng, point\.lat, point\.lng\)/);
  assert.match(server, /geocodeCandidateIsNearby\(lat, lng, center\[1\], center\[0\]\)/);
  assert.match(server, /geocodeCandidateIsNearby\(lat, lng, data\.lat, data\.lon\)/);
});

test('imprecise Google results cannot become a street address', () => {
  assert.match(server, /locationType === 'ROOFTOP' \|\| locationType === 'RANGE_INTERPOLATED'/);
  assert.match(server, /first && preciseLocation && point && geocodeCandidateIsNearby/);
});

test('remote locations fall back to a named geographic area, not a road', () => {
  assert.match(server, /function geographicAreaLabel\(data, lat, lng\)/);
  for (const key of ['forest', 'nature_reserve', 'park', 'river', 'waterway']) {
    assert.match(server, new RegExp(`'${key}'`));
  }
  assert.match(server, /zoom=14&addressdetails=1&namedetails=1&extratags=1/);
  assert.match(server, /return geographicAreaLabel\(await areaResponse\.json\(\), lat, lng\)/);
});

 test('distant point-place names do not replace the photo locality', () => {
 const vm=require('node:vm');
 const source=server.slice(server.indexOf('function geographicAreaLabel('),server.indexOf('async function reverseGeocode('));
 const label=vm.runInNewContext(source+';geographicAreaLabel',{geocodeCandidateIsNearby:(lat,lng,y,x)=>Math.hypot(lat-Number(y),lng-Number(x))*111000<=35});
 const point={category:'place',name:'Puti',lat:'10.3116231',lon:'123.8544703',address:{hamlet:'Puti',city:'Cebu City',region:'Central Visayas'}};
 assert.equal(label(point,10.30156,123.86880),'Cebu City, Central Visayas');
 assert.equal(label(point,10.3116231,123.8544703),'Puti, Cebu City, Central Visayas');
 assert.equal(label({category:'boundary',name:'Tisa',address:{suburb:'Tisa',city:'Cebu City',region:'Central Visayas'}},10.30156,123.86880),'Tisa, Central Visayas');
 });

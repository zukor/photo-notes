const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const db=fs.readFileSync(path.join(root,'db.js'),'utf8');

test('geocoder Mill abbreviation is expanded only at the end of the street line',()=>{
  assert.match(server,/function normalizeGeocodedAddress\(value\)/);
  assert.match(server,/replace\(\/\\bMl\\\.\?\$\/i,'Mill'\)/);
  assert.match(server,/normalizeGeocodedAddress\(\[street, city, regionZip\]\.join/);
  assert.match(server,/normalizeGeocodedAddress\(first\.formatted_address\)/);
});

test('existing saved Mill addresses are repaired during the safe startup migration',()=>{
  assert.match(db,/regexp_replace\(address, ' Ml,', ' Mill,', 'i'\)/);
  assert.match(db,/WHERE address ~\* ' Ml,'/);
});

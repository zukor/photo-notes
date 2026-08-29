const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

test('production refuses a missing or weak session secret', () => {
  assert.match(server, /NODE_ENV === 'production'[\s\S]*SESSION_SECRET\.length < 32/);
  assert.match(server, /Production requires a unique SESSION_SECRET/);
});

test('security headers protect the application without blocking required photo tools', () => {
  for (const header of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Strict-Transport-Security', 'Content-Security-Policy']) {
    assert.match(server, new RegExp(header));
  }
  assert.match(server, /script-src 'self' 'nonce-\$\{cspNonce\}' https:\/\/unpkg\.com/);
  assert.match(server, /img-src 'self' data: blob:/);
  assert.match(server, /frame-ancestors 'none'/);
});

test('administrator page receives a per-request CSP nonce',()=>{
  assert.match(server,/cspNonce=crypto\.randomBytes\(18\)/);
  assert.match(server,/replace\('<script>',`<script nonce=/);
});

test('admin health distinguishes writable uploads from confirmed persistence', () => {
  assert.match(server, /id:'upload_persistence'/);
  assert.match(server, /UPLOAD_PERSISTENCE_CONFIRMED==='true'/);
  assert.match(server, /Writable storage is not proof of persistence/);
  assert.match(example, /UPLOAD_PERSISTENCE_CONFIRMED=false/);
});

test('admin health exposes integration readiness without exposing secrets', () => {
  assert.match(server, /id:'stripe'/);
  assert.match(server, /Restricted key configured/);
  assert.match(server, /Stripe server key is missing/);
  assert.doesNotMatch(server, /res\.json\([^\n]*STRIPE_RESTRICTED_KEY/);
  assert.doesNotMatch(server, /res\.json\([^\n]*STRIPE_SECRET_KEY/);
});

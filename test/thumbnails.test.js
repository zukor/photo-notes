const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const express = require('express'), sharp = require('sharp');
const thumbnails = require('../thumbnails');

async function server(dir) {
  const app = express(); thumbnails.register(app, { uploadDir: dir, sharp, logger: { warn() {} } });
  const s = app.listen(0, '127.0.0.1'); await new Promise(r => s.once('listening', r));
  return { base: `http://127.0.0.1:${s.address().port}`, close: () => s.close() };
}

test('thumbnails are small, rebuilt after the photo changes, and refuse unsafe names', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pn-thumbs-'));
  await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#808080' } }).jpeg({ quality: 95 }).toFile(path.join(dir, 'photo.jpg'));
  const s = await server(dir);
  try {
    let r = await fetch(s.base + '/thumbs/photo.jpg');
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/jpeg'); assert.equal(r.headers.get('cache-control'), 'private, no-cache');
    const first = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
    assert.equal(first.width, thumbnails.WIDTH); assert.ok(first.height <= thumbnails.WIDTH);
    // A restored or replaced photo keeps its name; the thumbnail must follow it.
    await new Promise(r => setTimeout(r, 20));
    await sharp({ create: { width: 1000, height: 3000, channels: 3, background: '#000000' } }).jpeg().toFile(path.join(dir, 'photo.jpg'));
    r = await fetch(s.base + '/thumbs/photo.jpg');
    const second = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
    assert.ok(second.height > second.width, 'rebuilt from the new photo');
    for (const bad of ['..%2Fsecret.jpg', '.thumbs', 'missing.jpg', 'notes.txt']) assert.equal((await fetch(s.base + '/thumbs/' + bad)).status, 404, bad);
    assert.equal(thumbnails.thumbPathFor(dir, '/uploads/photo.jpg'), path.join(dir, '.thumbs', 'photo.jpg.w480.jpg'));
    assert.equal(thumbnails.thumbPathFor(dir, '/uploads/../x.jpg'), null);
  } finally { s.close(); }
});

test('a photo that cannot be shrunk still shows, using the full image', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pn-thumbs-'));
  fs.writeFileSync(path.join(dir, 'broken.jpg'), 'not an image');
  const s = await server(dir);
  try {
    const r = await fetch(s.base + '/thumbs/broken.jpg', { redirect: 'manual' });
    assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/uploads/broken.jpg');
  } finally { s.close(); }
});

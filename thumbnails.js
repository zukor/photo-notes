'use strict';
// Small Library thumbnails. Cards used to download every full-size photo (often 2 to 5 MB).
// A thumbnail is made once per photo, rebuilt when the photo file changes, and checked by
// the browser cheaply (304) so an edited photo never shows a stale thumbnail.
const fs = require('fs'), path = require('path');
const WIDTH = 480, QUALITY = 72;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif']);

function thumbName(name) { return `${name}.w${WIDTH}.jpg`; }
function thumbPathFor(uploadDir, photoPath) {
  const name = typeof photoPath === 'string' && photoPath.startsWith('/uploads/') ? photoPath.slice(9) : '';
  return NAME.test(name) ? path.join(uploadDir, '.thumbs', thumbName(name)) : null;
}

function createLimiter(max) {
  let running = 0; const queue = [];
  const next = () => { if (running >= max || !queue.length) return; running++; const { work, resolve, reject } = queue.shift(); work().then(resolve, reject).finally(() => { running--; next(); }); };
  return work => new Promise((resolve, reject) => { queue.push({ work, resolve, reject }); next(); });
}

function register(app, { uploadDir, sharp, maxConcurrent = 3, logger = console }) {
  const dir = path.join(uploadDir, '.thumbs');
  const limit = createLimiter(maxConcurrent);
  const building = new Map();
  async function ensure(name, source, sourceStat) {
    const target = path.join(dir, thumbName(name));
    const existing = await fs.promises.stat(target).catch(() => null);
    if (existing && existing.mtimeMs >= sourceStat.mtimeMs) return target;
    if (building.has(target)) return building.get(target);
    const job = limit(async () => {
      await fs.promises.mkdir(dir, { recursive: true });
      const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
      try {
        await sharp(source, { failOn: 'none' }).rotate().resize({ width: WIDTH, height: WIDTH, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: QUALITY, mozjpeg: true }).toFile(temp);
        await fs.promises.rename(temp, target);
      } catch (error) { await fs.promises.unlink(temp).catch(() => {}); throw error; }
      return target;
    }).finally(() => building.delete(target));
    building.set(target, job);
    return job;
  }
  app.get('/thumbs/:name', async (req, res) => {
    const name = String(req.params.name || '');
    if (!NAME.test(name) || !IMAGE_EXT.has(path.extname(name).toLowerCase())) return res.status(404).end();
    const source = path.join(uploadDir, name);
    const stat = await fs.promises.stat(source).catch(() => null);
    if (!stat || !stat.isFile()) return res.status(404).end();
    try {
      const file = await ensure(name, source, stat);
      res.set({ 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.type('image/jpeg').sendFile(file, { dotfiles: 'allow' });
    } catch (error) {
      logger.warn('[thumbs]', name, error && error.message);
      // Show the full photo rather than nothing. A signed link stays signed (it covers the photo and its thumbnail).
      const query = req.query && req.query.sig ? `?exp=${encodeURIComponent(String(req.query.exp || ''))}&sig=${encodeURIComponent(String(req.query.sig))}` : '';
      res.redirect(302, '/uploads/' + encodeURIComponent(name) + query);
    }
  });
}

module.exports = { register, thumbPathFor, thumbName, createLimiter, WIDTH };

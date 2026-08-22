// Regenerates the PWA / favicon PNGs from the Photo Notes mark at build time.
// Rendering from the SVG keeps the icons in sync with the brand artwork.
// Failure is non-fatal so a build never breaks over icon generation.
const fs = require('fs');
const path = require('path');
const pub = path.join(__dirname, '..', 'public');
const src = path.join(pub, 'photo-notes-mark.svg');
const sizes = { 'favicon-32.png': 32, 'icon-180.png': 180, 'icon-192.png': 192, 'icon-512.png': 512 };

(async () => {
  try {
    const sharp = require('sharp');
    const svg = fs.readFileSync(src);
    for (const [name, size] of Object.entries(sizes)) {
      await sharp(svg, { density: 512 })
        .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
        .png()
        .toFile(path.join(pub, name));
    }
    console.log('[icons] generated', Object.keys(sizes).join(', '));
  } catch (e) {
    console.error('[icons] skipped:', e && e.message);
  }
})();

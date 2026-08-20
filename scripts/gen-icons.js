// Recreates PWA icons + favicon at build time from an inline SVG using sharp
// (already a dependency). No embedded base64, no external image files needed.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pub = path.join(__dirname, '..', 'public');

// The Photo Notes bubble mark (blue speech bubble with three white bars).
const MARK = `<g transform="translate(25.04,40.12) scale(1.16)">
    <rect x="0" y="0" width="112" height="64" rx="10" fill="#1d4ed8"/>
    <path d="M 16 62 L 16 86 L 38 62 Z" fill="#1d4ed8"/>
    <rect x="18" y="13" width="74" height="8" rx="4" fill="#ffffff"/>
    <rect x="18" y="28" width="74" height="8" rx="4" fill="#ffffff"/>
    <rect x="18" y="43" width="46" height="8" rx="4" fill="#ffffff"/>
  </g>`;
// App icon: white square background + centered mark (iOS masks corners).
const APP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 180 180"><rect width="180" height="180" fill="#ffffff"/>${MARK}</svg>`;
// Favicon: transparent mark only.
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 180 180">${MARK}</svg>`;

async function run() {
  const big = await sharp(Buffer.from(APP_ICON)).png().toBuffer();
  await sharp(big).resize(512, 512).png().toFile(path.join(pub, 'icon-512.png'));
  await sharp(big).resize(192, 192).png().toFile(path.join(pub, 'icon-192.png'));
  await sharp(big).resize(180, 180).png().toFile(path.join(pub, 'icon-180.png'));
  await sharp(Buffer.from(FAVICON)).resize(32, 32).png().toFile(path.join(pub, 'favicon-32.png'));
  console.log('[icons] generated icon-180/192/512 + favicon-32 from svg via sharp');
}
run().catch((e) => { console.error('[icons] generation skipped:', e && e.message); });

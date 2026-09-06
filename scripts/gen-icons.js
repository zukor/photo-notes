// Original artwork is immutable. Only resize for web usage; never crop,
// recolor, round corners, or adjust the intentionally different proportions.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pub = path.join(__dirname, '..', 'public');
const source = path.join(__dirname, '..', 'assets', 'app-icons');

(async () => {
  for (const size of [16, 32, 48]) {
    fs.copyFileSync(path.join(source, `photo-notes-favicon-${size}.png`), path.join(pub, `favicon-${size}.png`));
  }
  for (const size of [180, 192, 512]) {
    await sharp(path.join(source, 'photo-notes-icon-1024.png'))
      .resize(size, size).png().toFile(path.join(pub, `icon-${size}.png`));
  }
  // Web manifests take a flattened image. Composite the adaptive layers at
  // their original coordinates, then resize the complete square.
  const adaptive = await sharp(path.join(source, 'photo-notes-icon-android-background.svg'))
    .composite([{ input: path.join(source, 'photo-notes-icon-android-foreground.svg'), left: 0, top: 0 }])
    .png().toBuffer();
  for (const size of [192, 512]) {
    await sharp(adaptive).resize(size, size).png().toFile(path.join(pub, `icon-maskable-${size}.png`));
  }
  console.log('[icons] generated web icons from the approved package');
})().catch(error => {
  console.error('[icons] generation failed:', error.message);
  process.exitCode = 1;
});

// Load before sharp/libvips initializes fontconfig. Minimal production images do
// not include fonts: SVG geometry still works there, but text becomes boxes.
const path = require('node:path');
const fs = require('node:fs');
const directory = path.join(__dirname, 'assets', 'annotation-fonts');
for (const name of ['fonts.conf', 'LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf', 'LiberationSerif-Regular.ttf', 'LiberationMono-Regular.ttf']) {
  if (!fs.existsSync(path.join(directory, name))) throw new Error(`Annotation font asset missing: ${name}`);
}
process.env.FONTCONFIG_FILE = path.join(directory, 'fonts.conf');
module.exports = { directory };

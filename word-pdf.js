const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
let active = false;
// Each conversion gets a private profile and directory. Do not serve a generic
// PDF when template conversion fails, since that would silently change content.
async function convertWordToPdf(buffer) {
  if (active) throw new Error('Another template PDF is being generated. Please try again shortly.');
  active = true;
  let dir;
  try {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pn-word-pdf-'));
    const input = path.join(dir, 'document.docx');
    const profile = path.join(dir, 'profile');
    await fs.mkdir(path.join(profile, 'user'), {recursive:true});
    await fs.writeFile(path.join(profile,'user','registrymodifications.xcu'), `<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item></oor:items>`);
    await fs.writeFile(input, buffer);
    await execFile(process.env.SOFFICE_PATH || 'soffice', [
      `-env:UserInstallation=${pathToFileURL(path.join(dir, 'profile')).href}`,
      '--headless', '--nologo', '--nodefault', '--norestore',
      '--convert-to', 'pdf:writer_pdf_Export', '--outdir', dir, input,
    ], { timeout: 60000, maxBuffer: 1024 * 1024 });
    const pdf = await fs.readFile(path.join(dir, 'document.pdf'));
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid converted PDF');
    return pdf;
  } finally {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    active = false;
  }
}
module.exports = { convertWordToPdf };

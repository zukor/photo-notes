const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public','styles.css'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const db=fs.readFileSync(path.join(root,'db.js'),'utf8');

test('document branding and templates are persistent and owner scoped',()=>{
  assert.match(db,/document_branding JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(db,/document_logo_path TEXT/);
  assert.match(db,/word_template_path TEXT/);
  assert.match(db,/layout JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(server,/app\.get\('\/api\/document-settings', requireAuth/);
  assert.match(server,/app\.post\('\/api\/document-settings\/logo', requireAuth, upload\.single\('logo'\)/);
  assert.match(server,/app\.post\('\/api\/document-settings\/template', requireAuth, upload\.single\('template'\)/);
  assert.match(server,/template must contain \{\{PHOTO_NOTES_CONTENT\}\}/);
  assert.match(server,/UPDATE users SET document_logo_path=\$1,document_logo_name=\$2 WHERE id=\$3/);
});

test('Create provides a focused document composer and paginated preview',()=>{
  assert.match(app,/Company Branding &amp; Word Template/);
  assert.match(app,/Page Layout &amp; Preview/);
  assert.match(app,/Upload Logo/);
  assert.match(app,/Import Word Template/);
  assert.match(app,/Download Starter Template/);
  assert.match(app,/One photo per page/);
  assert.match(app,/Two photos per page/);
  assert.match(app,/Cover page/);
  assert.match(app,/Header/);
  assert.match(app,/Footer/);
  assert.match(app,/Page numbers/);
  assert.match(app,/function renderDocumentPreview\(/);
  assert.match(css,/\.document-preview-page \{[^}]*min-height:880px/);
  assert.match(css,/\.document-preview-photos\.two-up/);
});

test('PDF and Word exports use branding, layouts, and structured templates',()=>{
  assert.match(server,/function applyStructuredWordTemplate/);
  assert.match(server,/\{\{PHOTO_NOTES_CONTENT\}\}/);
  assert.match(server,/documentLogoAsset\(logoPath/);
  assert.match(server,/layout\.cover_page/);
  assert.match(server,/layout\.photo_layout==='two_per_page'/);
  assert.match(server,/new Header\(/);
  assert.match(server,/new Footer\(/);
  assert.match(server,/PageNumber\.CURRENT/);
  assert.match(server,/applyStructuredWordTemplate\(buf,templatePath/);
});

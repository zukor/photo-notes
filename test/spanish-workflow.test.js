const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function translator() {
  const nodes = [];
  class Element {
    constructor(attrs = {}) { this.attrs = attrs; }
    closest() { return null; }
    getAttribute(k) { return this.attrs[k]; }
    setAttribute(k, v) { this.attrs[k] = v; }
  }
  const document = { body: new Element(), documentElement: {}, readyState: 'loading',
    addEventListener() {}, dispatchEvent() {}, querySelectorAll: () => [],
    createTreeWalker: () => { let i=0; return {nextNode: () => nodes[i++]}; } };
  const context = { window: {}, document, Element, Node: {TEXT_NODE:3}, NodeFilter: {SHOW_ELEMENT:1,SHOW_TEXT:4},
    localStorage:{getItem:()=> 'es',setItem(){}}, CustomEvent: class {}, MutationObserver: class {observe(){}} };
  vm.runInNewContext(fs.readFileSync(process.env.I18N_SOURCE || 'public/i18n.js','utf8'),context);
  return {api:context.window.photoNotesI18n, nodes, Element};
}
test('retested workflow labels, title inputs and zoom controls translate',()=>{
  const {api,nodes,Element}=translator();
  const expected = {'Fences & Walls':'Cercas y muros','No Topic':'Sin tema','Change Photo Title':'Cambiar título de foto','Photo Title':'Título de foto','Save Title':'Guardar título','Zoom In':'Acercar','Zoom Out':'Alejar','Move Left':'Mover a la izquierda','Move Right':'Mover a la derecha','Move Up':'Mover hacia arriba','Move Down':'Mover hacia abajo','Reset Photo':'Restablecer foto','Share or Download Selected Captures':'Compartir o descargar capturas seleccionadas','Clear All':'Borrar todo','Download':'Descargar','Share':'Compartir','Untitled Photo':'Foto sin título','Unfiled':'Sin archivar','No notes':'Sin notas','Payments':'Pagos','Pay with Stripe':'Pagar con Stripe'};
  for(const [en,es] of Object.entries(expected)) nodes.push({nodeType:3,parentElement:new Element(),nodeValue:en});
  const input=new Element({placeholder:'Add a short descriptive title','aria-label':'Close photo viewer'});nodes.push(input);
  api.apply();
  assert.deepEqual(nodes.slice(0,-1).map(n=>n.nodeValue),Object.values(expected));
  assert.equal(input.attrs.placeholder,'Agregue un título descriptivo breve');
  assert.equal(input.attrs['aria-label'],'Cerrar visor de fotos');
  // Translation never touches a user's input value.
  input.value='My original title'; api.setLanguage('en');assert.equal(input.value,'My original title');
  assert.equal(api.t('Change Photo Title'),'Change Photo Title');
});
test('Send counts translate after selection changes and switch back to English',()=>{
  const {api}=translator();
  for(const n of [1,2,40]) {
    api.setLanguage('es');
    const en=`${n} capture${n===1?'':'s'} selected. Change the selection below or return to Organize.`;
    const es=api.t(en);assert.match(es,/Cambie la selección abajo/);
    assert.match(es,n===1?/1 captura seleccionada/:/capturas seleccionadas/);
    api.setLanguage('en');assert.equal(api.t(es),en);
  }
  api.setLanguage('es');assert.equal(api.t('Provided by Example'),'Proveedor: Example');
  assert.equal(api.t('Custom topic XYZ'),'Custom topic XYZ');
});
test('document branding and layout controls translate without changing template tokens',()=>{
 const {api}=translator();
 for(const label of ['2. Company Branding & Word Template','3. Page Layout & Preview','Header Text','Footer Text','Word Template','Download Starter Template','Import Word Template','Typeface','Photo Arrangement','Cover page','Page numbers','Save Layout','Photo Notes Test Checkout'])assert.notEqual(api.t(label),label,label);
 for(const token of ['{{PHOTO_NOTES_CONTENT}}','{{TITLE}}','{{DESCRIPTION}}','{{COMPANY_NAME}}'])assert.equal(api.t(token),token);
});

test('current document content section heading translates in the rendered text flow',()=>{
 const app=fs.readFileSync('public/app.js','utf8');
 const label=app.match(/<div class="formhead"[^>]*>([0-9]+\. Document Contents)<\/div>/)[1];
 const {api,nodes,Element}=translator();const node={nodeType:3,parentElement:new Element(),nodeValue:label};nodes.push(node);api.apply();
 assert.equal(node.nodeValue,'4. Contenido del documento');
 api.setLanguage('en');assert.equal(node.nodeValue,label);
});

test('Send summary sentence, selection box and step labels translate and switch back to English',()=>{
 const {api}=translator();
 const cases={
  'Share 6 PhotoNotes as a PDF, using Account Defaults.':'Compartir 6 PhotoNotes como PDF, con Valores predeterminados de la cuenta.',
  'Send 1 PhotoNote as a Word file, using Field Copy to Office Email.':'Enviar 1 PhotoNote como archivo de Word, con Field Copy a Office Email.',
  'Share 3 PhotoNotes as original photos.':'Compartir 3 PhotoNotes como fotos originales.',
  '6 PhotoNotes selected':'6 PhotoNotes seleccionadas','1 PhotoNote selected':'1 PhotoNote seleccionada',
  'Document, 14 PhotoNotes':'Documento, 14 PhotoNotes','Project: Oak Plaza':'Proyecto: Oak Plaza',
  'Format':'Formato','Settings':'Ajustes','Send It':'Enviarlo','Original Photos':'Fotos originales','Manage Presets':'Administrar ajustes preestablecidos','Or use a Shortcut':'O use un atajo',
  'Original photos are sent exactly as taken. No layout settings apply.':'Las fotos originales se envían tal como se tomaron. No se aplican ajustes de diseño.'};
 for(const [en,es] of Object.entries(cases)){api.setLanguage('es');assert.equal(api.t(en),es);api.setLanguage('en');assert.equal(api.t(es),en);}
});

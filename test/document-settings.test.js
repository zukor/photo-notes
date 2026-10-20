// One set of document settings: account defaults and Export Presets replace New Document browser storage,
// and captions belong to one document instead of overwriting the photo note.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('public/app.js','utf8'),server=fs.readFileSync('server.js','utf8'),db=fs.readFileSync('db.js','utf8'),client=fs.readFileSync('public/export-presets.js','utf8');
const {normalize}=require('../export-presets');
const slice=(source,from,to)=>{const a=source.indexOf(from);assert.ok(a>=0,from);const b=source.indexOf(to,a+from.length);assert.ok(b>a,to);return source.slice(a,b);};

function loadClient({rows=[],account={layout_saved:false,branding:{}},failPreset=false,failAccount=false,store={}}={}){
  const posts=[],accountPosts=[];
  const localStorage={getItem:k=>Object.hasOwn(store,k)?store[k]:null,setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}};
  const api=async(url,opts={})=>{const method=opts.method||'GET',body=opts.body?JSON.parse(opts.body):null;
    if(url==='/api/export-presets'&&method==='GET')return {ok:true,json:async()=>rows};
    if(url==='/api/export-presets'&&method==='POST'){if(failPreset)return {ok:false,json:async()=>({error:'Could not save preset. Try again.'})};const row={id:rows.length+1,...body,config:normalize(body.config).config};rows.push(row);posts.push(body);return {ok:true,json:async()=>row};}
    if(url==='/api/document-settings'&&method==='GET')return {ok:true,json:async()=>account};
    if(url==='/api/document-settings'&&method==='POST'){if(failAccount)return {ok:false,json:async()=>({})};accountPosts.push(body);account.layout_saved=true;return {ok:true,json:async()=>account};}
    throw Error('unexpected '+method+' '+url);};
  const ctx={window:{},localStorage,api,state:{plan:'pro',proType:'general',me:{id:7}},isProClient:()=>true,structuredClone,console};
  vm.createContext(ctx);vm.runInContext(client,ctx);
  return {presets:ctx.window.PhotoNotesExportPresets,store,rows,posts,accountPosts,ctx};
}

test('a preset holds every New Document layout option and branding text',()=>{
  const layout={document_type:'exhibit',orientation:'landscape',photo_layout:'three_horizontal',font:'Helvetica',accent:'#123456',header:true,header_text:'H',footer:false,footer_text:'F',page_numbers:true,page_number_position:'bottom_center',cover_page:true,company_name:'Co'};
  const {presets}=loadClient();const config=presets.configFromLayout(layout);
  const plain=JSON.parse(JSON.stringify(config));
  assert.deepEqual(normalize(plain).config,plain,'the server keeps every option');
  assert.deepEqual(normalize(plain).warnings,[]);
  assert.deepEqual(plain.branding,{company_name:'Co',header_text:'H',footer_text:'F'});
  assert.equal(config.layout.header_text,undefined,'branding text is not a layout option');
});

test('browser presets and defaults are copied to the account once, keeping names, then removed',async()=>{
  const store={'pn-document-presets-7':JSON.stringify([{id:'a',name:'Roof',layout:{photo_layout:'two_vertical'}},{id:'b',name:'Walk',layout:{photo_layout:'six_per_page',company_name:'Walk Co'}}]),'pn-document-default-7':JSON.stringify({layout:{photo_layout:'one_per_page',header_text:'Local header',company_name:'Local Co'}})};
  const rows=[{id:90,name:'Roof',config:normalize({layout:{photo_layout:'two_vertical'},branding:{company_name:'',header_text:'',footer_text:''}}).config}];
  const t=loadClient({rows,store,account:{layout_saved:false,branding:{company_name:'Account Co',header_text:'',footer_text:''}}});
  assert.equal((await t.presets.migrateLocal()).copied,2,'the identical Roof preset is not copied again');
  assert.deepEqual(t.rows.map(r=>r.name),['Roof','Walk','New Document Defaults']);
  assert.ok(t.posts.every(p=>p.is_default===false),'a copied preset never becomes the default');
  assert.deepEqual(Object.keys(t.store),[]);
  assert.equal(t.accountPosts.length,1);assert.equal(t.accountPosts[0].company_name,'Account Co','saved account branding wins');assert.equal(t.accountPosts[0].header_text,'Local header','empty account branding is filled');
  assert.equal((await t.presets.migrateLocal()).copied,0,'nothing left to move');
});

test('a name used by a different preset gets a suffix instead of replacing it',async()=>{
  const store={'pn-document-presets-7':JSON.stringify([{name:'Roof',layout:{photo_layout:'four_per_page'}}])};
  const t=loadClient({store,rows:[{id:1,name:'Roof',config:normalize({layout:{photo_layout:'two_vertical'}}).config}]});
  await t.presets.migrateLocal();assert.deepEqual(t.rows.map(r=>r.name),['Roof','Roof (New Document)']);
  assert.equal(t.rows[0].config.layout.photo_layout,'two_vertical','the existing preset is unchanged');
});

test('a failed copy keeps the browser settings for the next visit',async()=>{
  const store={'pn-document-presets-7':JSON.stringify([{name:'Roof',layout:{}}])};
  const t=loadClient({store,failPreset:true});
  await assert.rejects(t.presets.migrateLocal());assert.ok(t.store['pn-document-presets-7'],'nothing is lost');
  const unreadable=loadClient({store:{'pn-document-presets-7':'{not json'}});
  assert.equal((await unreadable.presets.migrateLocal()).copied,0);assert.equal(unreadable.store['pn-document-presets-7'],'{not json','unreadable settings are left in place');
  const basic=loadClient({store:{'pn-document-presets-7':'[]'}});basic.ctx.isProClient=()=>false;
  assert.equal((await basic.presets.migrateLocal()).copied,0);assert.equal(basic.store['pn-document-presets-7'],'[]','editions without presets keep their browser settings');
});

test('New Document setup no longer keeps settings in browser storage or claims automatic saving',()=>{
  assert.doesNotMatch(app,/pn-document-\$\{kind\}|writeDocumentSetting|readDocumentSetting/);
  assert.doesNotMatch(app,/Changes are automatically saved/);
  const setup=slice(app,'function documentSetupFields(){','async function renderNewDocumentPhotos(){');
  assert.doesNotMatch(setup,/\bprompt\(|\bconfirm\(|\balert\(/,'no browser dialogs');
  assert.match(setup,/<option value="">Account Defaults<\/option>/);
  assert.match(setup,/PhotoNotesExportPresets\.create\(/,'Save as Preset saves an Export Preset');
  assert.match(setup,/fd\.append\('scope','account'\)/,'Save as Default stores the account default Word template');
  assert.match(app,/use_default_template:!newDocumentSetup\.template/);
});

test('account defaults keep layout options and branding apart',()=>{
  const ctx={ticketText:(v,n)=>String(v||'').slice(0,n)};vm.createContext(ctx);
  vm.runInContext(slice(server,'const DOCUMENT_FONTS','function cleanDocumentBranding(')+slice(server,'function accountDocumentLayout(','// A new document starts'),ctx);
  const l=ctx.accountDocumentLayout({font:'Georgia',photo_layout:'two_vertical',header_text:'Header',company_name:'Co'});
  assert.equal(l.font,'Georgia');assert.equal(l.photo_layout,'two_vertical');assert.equal(l.header_text,'');assert.equal(l.company_name,'');
  assert.equal(ctx.accountDocumentLayout(null).font,'Arial');
  assert.match(db,/ALTER TABLE users ADD COLUMN IF NOT EXISTS document_layout JSONB/);
  assert.match(db,/ALTER TABLE users ADD COLUMN IF NOT EXISTS default_template_path TEXT/);
  for(const file of ['upload-access.js','user-deletion.js'])assert.match(fs.readFileSync(file,'utf8'),/default_template_path/,file+' tracks the default template file');
});

test('document captions replace the note only in that document and its exports',()=>{
  const ctx={};vm.createContext(ctx);vm.runInContext(slice(server,'function applyDocumentCaptions(','async function resolveExport('),ctx);
  const rows=ctx.applyDocumentCaptions([{note:'Photo note',document_caption:'Document caption'},{note:'Kept',document_caption:null},{note:'Blank',document_caption:'   '}]);
  assert.deepEqual(rows.map(r=>r.note),['Document caption','Kept','Blank']);assert.ok(rows.every(r=>!('document_caption' in r)));
  assert.match(db,/ALTER TABLE group_items ADD COLUMN IF NOT EXISTS caption TEXT/);
  assert.match(server,/gi\.caption AS document_caption FROM group_items gi/);
  assert.match(server,/applyDocumentCaptions\(sourceRows\);/);
  const items=slice(app,'function renderGroupItems() {','function renderGroupPairPreview() {');
  assert.doesNotMatch(items,/\/api\/captures\/\$\{item\.id\}/,'saving a caption never changes the photo note');
  assert.match(items,/\/api\/groups\/\$\{currentGroup\.id\}\/caption/);
  assert.match(items,/class="btn secondary slim gusenote"/);
  const hctx={};vm.createContext(hctx);vm.runInContext(slice(app,'function hasDocumentCaption(','function renderGroupItems() {'),hctx);
  assert.equal(hctx.documentCaption({note:'N',document_caption:null}),'N');assert.equal(hctx.documentCaption({note:'N',document_caption:'C'}),'C');assert.equal(hctx.documentCaption({note:'N',document_caption:' '}),'N');
  assert.match(app,/<p>\$\{esc\(documentCaption\(c\)\|\|'No notes'\)\}<\/p>/,'the preview uses the document caption');
});

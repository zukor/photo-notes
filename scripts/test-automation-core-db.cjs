'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),jwt=require('jsonwebtoken'),sharp=require('sharp'),Zip=require('pizzip');
(async()=>{
 const connection=process.env.PN_ISOLATED_DATABASE_URL;
 if(!connection||new URL(connection).pathname!='/pn_core_test')throw Error('Isolated pn_core_test required');
 process.env.DATABASE_URL=connection;process.env.SESSION_SECRET='core-testing-only-secret';
 const upload=await fs.mkdtemp(path.join(os.tmpdir(),'pn-core-upload-'));process.env.UPLOAD_DIR=upload;
 const {pool,init}=require('../db');let server;
 try{
  await init();
  const {editionIds,user}=require('../test/support/factories.cjs');const accounts={};
  for(const edition of editionIds){const fixture=user(edition);accounts[edition]=(await pool.query("INSERT INTO users(email,password_hash,name,plan,pro_type,edition_access) VALUES($1,'unused',$2,$3,$4,$5) RETURNING id",[fixture.email,fixture.name,fixture.plan,fixture.pro_type,fixture.edition_access])).rows[0].id;}
  const image=await sharp({create:{width:240,height:180,channels:3,background:'#123456'}}).jpeg().toBuffer();await fs.writeFile(path.join(upload,'original.jpg'),image);
  const owner=accounts.pro,other=accounts.concrete;
  const sha=require('node:crypto').createHash('sha256').update(image).digest('hex');
  const id=(await pool.query("INSERT INTO captures(user_id,photo_path,photo_title,note) VALUES($1,'/uploads/original.jpg','Visible title','Public note') RETURNING id",[owner])).rows[0].id;
  await pool.query("INSERT INTO photo_comments(capture_id,author_id,author_name,text) VALUES($1,$2,'Internal author','INTERNAL ONLY SECRET COMMENT')",[id,owner]);
  await pool.query('UPDATE captures SET custom_fields=$1 WHERE id=$2',[JSON.stringify([{name:'Surface',type:'text',value:'Concrete fixture'}]),id]);
  await pool.query('INSERT INTO capture_evidence(capture_id,user_id,original_sha256,original_bytes) VALUES($1,$2,$3,$4)',[id,owner,sha,image.length]);
  const evidenceBefore=(await pool.query('SELECT * FROM capture_evidence WHERE capture_id=$1',[id])).rows[0];
  const before=(await pool.query('SELECT * FROM captures WHERE id=$1',[id])).rows[0];
  // Repeat startup migration on populated data, protecting original evidence.
  await init();assert.deepEqual((await pool.query('SELECT * FROM captures WHERE id=$1',[id])).rows[0],before);
  const {app}=require('../server');server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  const call=(route,uid=owner)=>fetch(base+route,{headers:{Cookie:'pn_token='+jwt.sign({id:uid},process.env.SESSION_SECRET)}});
  for(const edition of editionIds){const r=await call('/api/me',accounts[edition]);assert.equal(r.status,200,edition+' account');const me=await r.json();assert.equal(require('../editions').currentEdition(me),edition,edition+' backend identity');}
  assert.equal((await fetch(base+'/api/captures')).status,401);
  assert.equal((await call('/api/captures/'+id+'/evidence',other)).status,404);
  for(const format of ['pdf','docx','bundle']){
   const r=await call('/api/export/'+format+'?ids='+id);assert.equal(r.status,200,format+' export');const bytes=Buffer.from(await r.arrayBuffer());assert(bytes.length>100,format+' file');
   if(format==='pdf'){assert.equal(bytes.subarray(0,4).toString(),'%PDF');const text=require('node:child_process').execFileSync('pdftotext',['-','-'],{input:bytes,encoding:'utf8'});assert(text.includes('Concrete fixture'));assert(!text.includes('INTERNAL ONLY SECRET COMMENT'));}
   if(format==='docx'){const zip=new Zip(bytes);assert.match(zip.file('word/document.xml').asText(),/Visible title/);assert.match(zip.file('word/document.xml').asText(),/Concrete fixture/);assert(!zip.file('word/document.xml').asText().includes('INTERNAL ONLY SECRET COMMENT'));assert(Object.keys(zip.files).some(n=>n.startsWith('word/media/')&&!n.endsWith('/')));}
   if(format==='bundle'){const zip=new Zip(bytes);assert.match(zip.file('photonotes.md').asText(),/Public note/);assert.match(zip.file('photonotes.md').asText(),/Concrete fixture/);assert(!zip.file('photonotes.md').asText().includes('INTERNAL ONLY SECRET COMMENT'));assert(Object.keys(zip.files).some(n=>n.startsWith('photos/')));}
   const foreign=await call('/api/export/'+format+'?ids='+id,other);assert.equal(foreign.status,200,format+' supports an empty authorized export');
   const privateBytes=Buffer.from(await foreign.arrayBuffer());
   if(format==='pdf'){const text=require('node:child_process').execFileSync('pdftotext',['-','-'],{input:privateBytes,encoding:'utf8'});assert(!text.includes('Public note'));assert(!text.includes('Visible title'));}
   else {const zip=new Zip(privateBytes);const text=zip.file(format==='docx'?'word/document.xml':'photonotes.md').asText();assert(!text.includes('Public note'));assert(!text.includes('Visible title'));assert(!Object.keys(zip.files).some(n=>/^(word\/media|photos)\//.test(n)&&!n.endsWith('/')));}
  }
  assert.deepEqual(await fs.readFile(path.join(upload,'original.jpg')),image);
  assert.deepEqual((await pool.query('SELECT * FROM captures WHERE id=$1',[id])).rows[0],before);
  assert.deepEqual((await pool.query('SELECT * FROM capture_evidence WHERE capture_id=$1',[id])).rows[0],evidenceBefore);
  console.log('PASS fresh schema, populated restart migration, ten account editions, auth, owner isolation, PDF/Word/Markdown and original evidence');
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await pool.end();await fs.rm(upload,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});

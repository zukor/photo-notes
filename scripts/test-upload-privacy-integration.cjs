'use strict';
// Fresh local database only. Uploaded files are private: owners, company teammates and signed links.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),jwt=require('jsonwebtoken'),bcrypt=require('bcryptjs'),sharp=require('sharp');
const target=new URL(process.env.DATABASE_URL||'');
assert(['127.0.0.1','localhost'].includes(target.hostname));assert.equal(target.pathname,'/pn_upload_privacy_test');
assert(process.env.UPLOAD_DIR,'UPLOAD_DIR required');fs.mkdirSync(process.env.UPLOAD_DIR,{recursive:true});
process.env.AI_DAILY_LIMIT='2';
(async()=>{const {pool,init}=require('../db');await init();let server;try{
 const {app}=require('../server');server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const dir=process.env.UPLOAD_DIR,secret=process.env.SESSION_SECRET;
 const user=async(email,extra={})=>(await pool.query("INSERT INTO users(email,name,password_hash,plan,pro_type,role) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",[email,'Fixture '+email,extra.hash||'unused',extra.plan||'pro',extra.pro_type||'property',extra.role||'user'])).rows[0];
 const owner=await user('owner@example.invalid'),mate=await user('mate@example.invalid'),outsider=await user('outsider@example.invalid'),admin=await user('admin-review@example.invalid',{role:'admin'}),regularAdmin=await user('admin-regular@example.invalid',{role:'admin'}),manager=await user('manager@example.invalid');
 process.env.SUPER_ADMIN_USER_IDS=String(admin.id);await pool.query('UPDATE users SET is_testing_manager=true WHERE id=$1',[manager.id]);
 const cookie=u=>'pn_token='+jwt.sign({id:u.id},secret);
 const get=async(url,u,opts={})=>fetch(base+url,{redirect:'manual',...opts,headers:{...(u?{Cookie:typeof u==='string'?u:cookie(u)}:{}),...(opts.headers||{})}});
 const jpeg=async color=>sharp({create:{width:640,height:480,channels:3,background:color}}).jpeg().toBuffer();
 const write=async(name,color='#246')=>{fs.writeFileSync(path.join(dir,name),await jpeg(color));return '/uploads/'+name;};
 const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,file))).digest('hex');

 // Company setup: owner and teammate share a company; the outsider does not.
 const company=(await pool.query("INSERT INTO hoa_management_companies(name) VALUES('Fixture Company') RETURNING id")).rows[0].id;
 for(const u of [owner,mate])await pool.query("INSERT INTO hoa_company_members(company_id,user_id,company_role) VALUES($1,$2,'member')",[company,u.id]);
 const community=(await pool.query("INSERT INTO hoa_communities(company_id,name) VALUES($1,'Fixture Property') RETURNING id",[company])).rows[0].id;
 const companyPhoto=await write('company-photo.jpg'),privatePhoto=await write('private-photo.jpg','#642');
 const companyCapture=(await pool.query("INSERT INTO captures(user_id,photo_path,note) VALUES($1,$2,'Company record photo') RETURNING id",[owner.id,companyPhoto])).rows[0].id;
 const privateCapture=(await pool.query("INSERT INTO captures(user_id,photo_path,note) VALUES($1,$2,'Private photo') RETURNING id",[owner.id,privatePhoto])).rows[0].id;
 const item=(await pool.query("INSERT INTO hoa_maintenance_items(company_id,community_id,title,created_by,capture_id) VALUES($1,$2,'Fixture item',$3,$4) RETURNING id",[company,community,owner.id,companyCapture])).rows[0].id;
 await pool.query("INSERT INTO hoa_item_photos(item_id,capture_id,photo_stage) VALUES($1,$2,'initial')",[item,companyCapture]);
 const plan=await write('floor-plan.jpg','#ddd');
 await pool.query("INSERT INTO property_floor_plans(company_id,community_id,floor,photo_path,source) VALUES($1,$2,'1',$3,'upload')",[company,community,plan]);
 const shot=await write('issue-shot.jpg','#999');
 await pool.query("INSERT INTO issue_reports(user_id,description,screenshot_path) VALUES($1,'Fixture issue',$2)",[outsider.id,shot]);

 // Signed-in access follows the records each person can see.
 assert.equal((await get(privatePhoto)).status,401,'anonymous request is refused');
 assert.equal((await get('/thumbs/private-photo.jpg')).status,401,'anonymous thumbnail is refused');
 const own=await get(privatePhoto,owner);assert.equal(own.status,200,'the creator sees the photo');
 assert.match(own.headers.get('content-security-policy')||'',/sandbox/);assert.equal(own.headers.get('x-content-type-options'),'nosniff');assert.match(own.headers.get('cache-control')||'',/private/);
 assert.equal((await get('/thumbs/private-photo.jpg',owner)).status,200,'the creator sees the thumbnail');
 assert.equal((await get(privatePhoto,mate)).status,404,'a teammate cannot see a private photo');
 assert.equal((await get(privatePhoto,outsider)).status,404,'another user cannot see the photo');
 assert.equal((await get('/thumbs/private-photo.jpg',outsider)).status,404,'another user cannot see the thumbnail');
 assert.equal((await get(companyPhoto,mate)).status,200,'a teammate sees a company record photo');
 assert.equal((await get('/thumbs/company-photo.jpg',mate)).status,200);
 assert.equal((await get(companyPhoto,outsider)).status,404);
 assert.equal((await get(plan,mate)).status,200,'a teammate sees the floor plan');assert.equal((await get(plan,outsider)).status,404);
 assert.equal((await get(shot,outsider)).status,200,'the reporter sees the issue screenshot');
 assert.equal((await get(shot,admin)).status,200,'a Super Admin reviews issue screenshots');
 assert.equal((await get(shot,manager)).status,200,'a testing manager reviews issue screenshots');
 assert.equal((await get(shot,regularAdmin)).status,404,'matches the admin issue screen, which needs Super Admin or testing manager access');
 assert.equal((await get(privatePhoto,admin)).status,404,'administrators do not browse other people\'s photos');
 assert.equal((await get(shot,owner)).status,404);
 assert.equal((await get('/uploads/.thumbs/private-photo.jpg.w480.jpg',owner)).status,404);
 assert.equal((await get('/uploads/missing.jpg',owner)).status,404);

 // Signed links work for people without an account until they expire.
 const {signedUrl}=require('../upload-access');
 const signed=signedUrl(secret,privatePhoto,Date.now()+60000);
 assert.equal((await get(signed)).status,200,'a signed link works');
 assert.equal((await get(signed.replace('/uploads/','/thumbs/'))).status,200,'a signed link works for the thumbnail');
 assert.equal((await get(signedUrl(secret,privatePhoto,Date.now()-1000))).status,401,'an expired link fails');
 const tampered=signed.replace(/sig=([0-9a-f])/,(m,c)=>'sig='+(c==='0'?'1':'0'));
 assert.equal((await get(tampered)).status,401,'a tampered signature fails');
 assert.equal((await get(signed.replace('private-photo.jpg','company-photo.jpg'))).status,401,'a signature is tied to one file');
 assert.equal((await get(signed.replace(/exp=\d+/,m=>'exp='+(Number(m.slice(4))+3600)))).status,401,'a longer expiry needs a new signature');

 // The work link signs its photos with the link expiry.
 const token=crypto.randomBytes(24).toString('base64url'),expires=new Date(Date.now()+3*86400000);
 await pool.query("INSERT INTO hoa_completion_photo_requests(item_id,token,recipient_name,expires_at,created_by) VALUES($1,$2,'Vendor',$3,$4)",[item,token,expires,owner.id]);
 const work=await(await get('/api/public/work-spot/'+token)).json();
 assert.equal(work.photos.length,1);assert.match(work.photos[0].url,/^\/uploads\/company-photo\.jpg\?exp=\d+&sig=[0-9a-f]{64}$/);
 assert.equal(Number(new URL(base+work.photos[0].url).searchParams.get('exp')),Math.floor(expires.getTime()/1000));
 assert.equal((await get(work.photos[0].url)).status,200,'the worker sees the photo without an account');

 // Review links stop when the account that made them is inactive.
 const reviewToken=crypto.randomBytes(24).toString('base64url');
 await pool.query("INSERT INTO approval_packages(user_id,token,title,capture_ids,expires_at) VALUES($1,$2,'Fixture review',$3,now()+interval '1 day')",[owner.id,reviewToken,[privateCapture]]);
 assert.equal((await get('/review/'+reviewToken)).status,200);
 await pool.query('UPDATE users SET active=false WHERE id=$1',[owner.id]);
 assert.equal((await get('/review/'+reviewToken)).status,404,'review link closed for an inactive account');
 assert.equal((await get('/review/'+reviewToken+'/photos/'+privateCapture)).status,404);
 assert.equal((await get('/api/public/work-spot/'+token)).status,404,'work link closed for an inactive account');
 await pool.query('UPDATE users SET active=true WHERE id=$1',[owner.id]);

 // Rotate keeps one untouched original; crop removes replaced files; restore and delete clean up.
 const api=async(url,body,u=owner)=>{const r=await get(url,u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});return {status:r.status,data:await r.json().catch(()=>({}))};};
 const pristine=sha('private-photo.jpg');
 assert.equal((await api(`/api/captures/${privateCapture}/rotate`,{dir:'cw'})).status,200);
 assert.equal((await api(`/api/captures/${privateCapture}/rotate`,{dir:'cw'})).status,200);
 assert.equal(sha('private-photo-orig.jpg'),pristine,'the backup is the photo as first saved');
 assert.ok(!fs.readdirSync(dir).some(f=>f.endsWith('.tmp')),'no temporary files remain');
 await get('/thumbs/private-photo.jpg',owner);assert.ok(fs.existsSync(path.join(dir,'.thumbs','private-photo.jpg.w480.jpg')));
 const crop1=await api(`/api/captures/${privateCapture}/crop`,{x:10,y:10,w:50,h:50});assert.equal(crop1.status,200,JSON.stringify(crop1.data));
 assert.equal(crop1.data.capture.photo_original_path,'/uploads/private-photo-orig.jpg');
 assert.ok(!fs.existsSync(path.join(dir,'private-photo.jpg')),'the replaced photo is removed');
 assert.ok(!fs.existsSync(path.join(dir,'.thumbs','private-photo.jpg.w480.jpg')),'its thumbnail is removed');
 const crop1File=crop1.data.capture.photo_path.slice(9);
 const crop2=await api(`/api/captures/${privateCapture}/crop`,{x:0,y:0,w:80,h:80});assert.equal(crop2.status,200);
 assert.ok(!fs.existsSync(path.join(dir,crop1File)),'an earlier crop is removed');
 assert.equal(sha('private-photo-orig.jpg'),pristine,'the backup is unchanged by cropping');
 assert.equal((await api(`/api/captures/${privateCapture}/restore-original`)).status,200);
 const restored=(await pool.query('SELECT photo_path,photo_original_path FROM captures WHERE id=$1',[privateCapture])).rows[0];
 assert.equal(restored.photo_original_path,null);assert.equal(sha(restored.photo_path.slice(9)),pristine,'the original is back');
 assert.ok(!fs.existsSync(path.join(dir,'private-photo-orig.jpg')),'the backup is removed after restore');
 assert.equal((await api(`/api/captures/${privateCapture}/rotate`,{dir:'ccw'})).status,200);
 const edited=(await pool.query('SELECT photo_path,photo_original_path FROM captures WHERE id=$1',[privateCapture])).rows[0];
 await get('/thumbs/'+edited.photo_path.slice(9),owner);
 assert.equal((await api('/api/captures/delete',{ids:[privateCapture]})).status,200);
 for(const file of [edited.photo_path.slice(9),edited.photo_original_path.slice(9),'.thumbs/'+edited.photo_path.slice(9)+'.w480.jpg'])assert.ok(!fs.existsSync(path.join(dir,file)),'deleted with the photo: '+file);

 // Signing out ends only that session.
 const password='fixture-password-1';
 await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[bcrypt.hashSync(password,4),mate.id]);
 const login=async()=>{const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:mate.email,password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
 const phone=await login(),laptop=await login();assert.notEqual(phone,laptop);
 assert.equal((await get('/api/me',phone)).status,200);
 assert.equal((await get('/api/logout',phone,{method:'POST'})).status,200);
 assert.equal((await get('/api/me',phone)).status,401,'a signed-out session cannot be reused');
 assert.equal((await get(companyPhoto,phone)).status,401);
 assert.equal((await get('/api/me',laptop)).status,200,'other devices stay signed in');

 // New passwords need 8 characters; existing short passwords still sign in.
 const adminCookie=cookie(admin);
 const created=await get('/api/admin/users',adminCookie,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Short Password',email:'short@example.invalid',password:'1234567',edition_access:['basic']})});
 assert.equal(created.status,400);assert.match((await created.json()).error,/at least 8 characters/);
 const reset=await get(`/api/admin/users/${outsider.id}/password`,adminCookie,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'short'})});assert.equal(reset.status,400);
 await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[bcrypt.hashSync('abc',4),outsider.id]);
 assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:outsider.email,password:'abc'})})).status,200,'an existing short password still works');

 // Paid AI requests are capped per request and per day.
 const paver=await user('paver@example.invalid',{pro_type:'paving'});
 const paverPhoto=await write('paver.jpg');const paverCapture=(await pool.query('INSERT INTO captures(user_id,photo_path) VALUES($1,$2) RETURNING id',[paver.id,paverPhoto])).rows[0].id;
 const batch=await api('/api/captures/classify-batch',{ids:Array.from({length:51},(_,i)=>i+1)},paver);assert.equal(batch.status,400);assert.match(batch.data.error,/50 photos or fewer/);
 for(let n=0;n<2;n++)assert.notEqual((await api(`/api/captures/${paverCapture}/classify`,{},paver)).data.error,'daily_limit');
 const limited=await api(`/api/captures/${paverCapture}/classify`,{},paver);assert.equal(limited.status,429);assert.match(limited.data.ai_message,/today's limit of 2 AI classifications/);
 const measure=async()=>{const fd=new FormData();fd.append('capture_id',String(paverCapture));fd.append('reference_type','ruler_12in');const r=await get('/api/measure',paver,{method:'POST',body:fd});return {status:r.status,data:await r.json().catch(()=>({}))};};
 for(let n=0;n<2;n++)assert.notEqual((await measure()).status,429);
 const measureLimited=await measure();assert.equal(measureLimited.status,429);assert.match(measureLimited.data.ai_message,/today's limit of 2 AI measurements/);
 console.log('PASS private uploads: owner, teammate, outsider, admin, signed links, work and review links, rotate/crop/restore/delete cleanup, single-session sign out, password minimum, AI limits');
}finally{server?.close();await pool.end();}})().catch(e=>{console.error(e);process.exitCode=1;});

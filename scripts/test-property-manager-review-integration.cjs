'use strict';
// Fresh local database only. Property Manager Pro team workflow: navigation data, Property edits,
// document-only captures, team-member assignment, Assigned to Me, readable history and the Area report filter.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),jwt=require('jsonwebtoken'),sharp=require('sharp'),Zip=require('pizzip');
const target=new URL(process.env.DATABASE_URL||'');
assert(['127.0.0.1','localhost'].includes(target.hostname));assert.equal(target.pathname,'/pn_property_manager_review_test');
(async()=>{const {pool,init}=require('../db');await init();await init();let server;try{
 const {app}=require('../server');server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const makeUser=async(email,name,proType)=>(await pool.query("INSERT INTO users(email,name,password_hash,plan,pro_type,edition_access) VALUES($1,$2,'unused','pro',$3,ARRAY[$3]) RETURNING *",[email,name,proType])).rows[0];
 const lead=await makeUser('pm-lead@example.invalid','Fixture Lead','property'),mate=await makeUser('pm-mate@example.invalid','Fixture Mate','property'),hoaUser=await makeUser('pm-hoa@example.invalid','Fixture HOA','hoa'),general=await makeUser('pm-general@example.invalid','Fixture General','general');
 const client=user=>{const cookie='pn_token='+jwt.sign({id:user.id},process.env.SESSION_SECRET);const api=async(url,body)=>{const r=await fetch(base+url,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const type=r.headers.get('content-type')||'';return {status:r.status,data:type.includes('json')?await r.json():Buffer.from(await r.arrayBuffer())};};api.user=user;api.cookie=cookie;return api;};
 const A=client(lead),B=client(mate),H=client(hoaUser),G=client(general);
 // Edition wording on the shared gate and on team-member errors.
 const denied=await G('/api/hoa/company');assert.equal(denied.status,403);assert.doesNotMatch(denied.data.error,/^HOA Maintenance Pro or/);assert.match(denied.data.error,/Property Manager Pro/);
 await A('/api/hoa/company');await H('/api/hoa/company');
 const missing=await A('/api/hoa/members',{email:'nobody@example.invalid'});assert.equal(missing.status,404);assert.equal(missing.data.error,'No active Property Manager Pro user has that email');
 assert.equal((await A('/api/hoa/members',{email:mate.email})).status,200);
 const members=(await B('/api/hoa/members')).data;assert.deepEqual(members.map(m=>m.name).sort(),['Fixture Lead','Fixture Mate']);
 // Property create and edit.
 const property=(await A('/api/hoa/communities',{name:'Fixture Office Park',address:'1 Old Address',manager_name:'Old Contact'})).data;
 const edited=await B('/api/hoa/communities/'+property.id,{name:'Fixture Office Park East',address:'100 Main Street',manager_name:'Site Contact'});assert.equal(edited.status,200);assert.equal(edited.data.name,'Fixture Office Park East');assert.equal(edited.data.address,'100 Main Street');assert.equal(edited.data.manager_name,'Site Contact');
 assert.equal((await H('/api/hoa/communities/'+property.id,{name:'Cross-company edit'})).status,404);
 // Area filter validation.
 for(const bad of ['abc','0','1.5'])assert.equal((await A('/api/property/areas?community_id='+bad)).status,400,bad);
 const area=(await A('/api/property/areas',{community_id:property.id,name:'Rooftop'})).data,otherArea=(await A('/api/property/areas',{community_id:property.id,name:'Parking Lot'})).data;assert(area.id&&otherArea.id);
 // Capture: document-only and record-creating saves.
 const photo=await sharp({create:{width:120,height:90,channels:3,background:'#246'}}).jpeg().toBuffer();
 const upload=async(api,fields)=>{const fd=new FormData();fd.append('photo',new Blob([photo],{type:'image/jpeg'}),'fixture.jpg');for(const [k,v] of Object.entries(fields))fd.append(k,String(v));const r=await fetch(base+'/api/captures',{method:'POST',headers:{Cookie:api.cookie,'X-Photo-Notes-Capture-Id':crypto.randomUUID(),'X-Photo-Notes-Edition':'property','X-Photo-Notes-Account':crypto.createHash('sha256').update(api.user.email).digest('hex')},body:fd});return {status:r.status,data:await r.json()};};
 const documented=await upload(A,{note:'Roof drain documentation',hoa_community_id:property.id,property_area_id:area.id,hoa_create_record:'0',hoa_area:'Roofing',hoa_title:'Not a record'});assert.equal(documented.status,200,JSON.stringify(documented.data));
 assert.equal(documented.data.maintenance_item,null);assert.equal(documented.data.property_community_id,property.id);assert.equal(documented.data.property_area_id,area.id);
 assert.equal((await pool.query('SELECT count(*)::int n FROM hoa_maintenance_items')).rows[0].n,0,'Document-only capture opens no maintenance record');
 assert.equal((await pool.query('SELECT count(*)::int n FROM hoa_notifications')).rows[0].n,0,'Document-only capture notifies nobody');
 const roof=await upload(A,{note:'RTU-3 leaking at roof curb',hoa_community_id:property.id,property_area_id:area.id,hoa_create_record:'1',hoa_area:'HVAC',hoa_title:'RTU-3 leak'});assert.equal(roof.status,200,JSON.stringify(roof.data));const item=roof.data.maintenance_item;assert(item&&item.id);assert.equal(item.area,'HVAC');
 const lot=await upload(A,{note:'Pole light out',hoa_community_id:property.id,property_area_id:otherArea.id,hoa_area:'Lighting',hoa_title:'Pole light out',hoa_assignee:'fixture mate'});const lotItem=lot.data.maintenance_item;assert(lotItem);
 assert.equal(lotItem.primary_assignee_user_id,mate.id,'A typed teammate name resolves to the team member');
 assert((await B('/api/hoa/notifications')).data.some(n=>n.message==='Assigned to you: Pole light out'));
 // Assign to a teammate: specific notification, history and Assigned to Me.
 const before=(await B('/api/hoa/notifications')).data.length;
 const assigned=await A('/api/hoa/items/'+item.id,{primary_assignee_user_id:mate.id,primary_assignee:'ignored text',status:'scheduled'});assert.equal(assigned.status,200,JSON.stringify(assigned.data));assert.equal(assigned.data.primary_assignee_user_id,mate.id);assert.equal(assigned.data.primary_assignee,'Fixture Mate');
 const mateNotes=(await B('/api/hoa/notifications')).data;assert.equal(mateNotes.length,before+1,'The assignee gets one specific notification, not a duplicate general one');assert.equal(mateNotes[0].message,'Assigned to you: RTU-3 leak');assert.equal(mateNotes[0].item_id,item.id);
 assert.equal((await B('/api/hoa/dashboard')).data.mine,2);assert.equal((await A('/api/hoa/dashboard')).data.mine,0);
 assert.deepEqual((await B('/api/hoa/items?mine=1')).data.map(i=>i.id).sort((a,b)=>a-b),[item.id,lotItem.id].sort((a,b)=>a-b));
 const history=(await A('/api/hoa/items/'+item.id)).data.history;assert.deepEqual(history.map(h=>h.action),['created','status_changed','assigned']);assert.deepEqual(history[1].detail,{from:'new',to:'scheduled'});assert.equal(history[2].detail.assignee,'Fixture Mate');
 // Saving an unchanged form records nothing.
 assert.equal((await A('/api/hoa/items/'+item.id,{title:'RTU-3 leak',status:'scheduled',primary_assignee_user_id:mate.id})).status,200);assert.equal((await A('/api/hoa/items/'+item.id)).data.history.length,3);
 // Outside vendor free text clears the team-member link.
 const vendor=await A('/api/hoa/items/'+item.id,{primary_assignee_user_id:null,primary_assignee:'ACME Roofing'});assert.equal(vendor.data.primary_assignee_user_id,null);assert.equal(vendor.data.primary_assignee,'ACME Roofing');assert.equal((await B('/api/hoa/dashboard')).data.mine,1);
 // Older records without a user id still match by trimmed, case-insensitive name.
 await pool.query("UPDATE hoa_maintenance_items SET primary_assignee='  fixture MATE ',primary_assignee_user_id=NULL WHERE id=$1",[item.id]);assert.equal((await B('/api/hoa/dashboard')).data.mine,2);
 // People outside the company cannot be assigned.
 const outsider=await A('/api/hoa/items/'+item.id,{primary_assignee_user_id:hoaUser.id});assert.equal(outsider.status,400);assert.match(outsider.data.error,/Property Manager Pro team member/);
 // Maintenance Report: Area filter and batched photo loading.
 const report=async query=>{const r=await A('/api/hoa/report?doc=docx&'+new URLSearchParams(query));assert.equal(r.status,200);return new Zip(r.data).file('word/document.xml').asText();};
 const all=await report({});assert(all.includes('RTU-3 leak')&&all.includes('Pole light out'));assert(all.includes('Category: HVAC'));
 const rooftop=await report({property_area_id:area.id});assert(rooftop.includes('RTU-3 leak'));assert(!rooftop.includes('Pole light out'));
 assert.equal((await A('/api/hoa/report?property_area_id=abc')).status,400);
 const pdf=await A('/api/hoa/report?doc=pdf&property_area_id='+otherArea.id);assert.equal(pdf.status,200);assert.equal(pdf.data.subarray(0,4).toString(),'%PDF');
 console.log('PASS Property Manager Pro team assignment, document-only capture, Property edit, readable history, Assigned to Me and Area report filter');
 }finally{server?.close();await pool.end();}})().catch(e=>{console.error(e);process.exitCode=1;});

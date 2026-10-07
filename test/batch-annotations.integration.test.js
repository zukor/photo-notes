const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
test('batch annotations preserve, replace, enforce ownership and limits, and commit atomically',{skip:process.env.PN_ANNOTATION_TEST!=='1'},async()=>{
 process.env.DATABASE_URL=process.env.PN_LEGACY_TEST_DATABASE_URL;process.env.PGSSL='disable';const {pool,init}=require('../db');await init();
 const user=(await pool.query("INSERT INTO users(email,password_hash) VALUES($1,'none') RETURNING id",['annotation-'+Date.now()+'@example.invalid'])).rows[0].id;
 const other=(await pool.query("INSERT INTO users(email,password_hash) VALUES($1,'none') RETURNING id",['annotation-other-'+Date.now()+'@example.invalid'])).rows[0].id;
 const original=[{t:'custom',text:'Keep me',x:20,y:30}],ids=[];const make=async(owner=user,photo='/fixture.jpg',overlays=original)=>{const r=(await pool.query('INSERT INTO captures(user_id,photo_path,overlays) VALUES($1,$2,$3::jsonb) RETURNING id',[owner,photo,JSON.stringify(overlays)])).rows[0].id;ids.push(r);return r;};
 const a=await make(),b=await make(),foreign=await make(other),noPhoto=await make(user,null),full=await make(user,'/fixture.jpg',Array.from({length:20},()=>original[0]));
 const app=express();app.use(express.json());const auth=(req,res,next)=>{req.user={id:req.headers['x-fixture-user']==='other'?other:user};next()};require('../batch-annotations').registerBatchAnnotations(app,{pool,requireAuth:auth});require('../annotation-template-library').registerAnnotationTemplateLibrary(app,{pool,requireAuth:auth});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const post=body=>fetch(base+'/api/captures/annotations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const get=id=>pool.query('SELECT overlays FROM captures WHERE id=$1',[id]).then(r=>r.rows[0].overlays);
 try{let r=await post({ids:[a,b,a],template:'date_address',mode:'add'});assert.equal(r.status,200);assert.equal((await r.json()).updated,2);assert.equal((await get(a)).length,3);assert.deepEqual((await get(a))[0],original[0]);
 const before=await get(a);for(const bad of [foreign,noPhoto,full,999999999]){r=await post({ids:[a,bad],template:'copyright',mode:'add'});assert.equal(r.status,409);assert.deepEqual(await get(a),before,'no partial update');}
 assert.equal((await post({ids:[a],template:'copyright',mode:'replace'})).status,400);assert.deepEqual(await get(a),before);
 r=await post({ids:[a,b],template:'copyright',mode:'replace',confirm_replace:true});assert.equal(r.status,200);assert.equal((await get(a)).length,1);assert.equal((await get(a))[0].t,'copyright');
 assert.equal((await post({ids:[a],template:'__proto__',mode:'add'})).status,400);assert.equal((await post({ids:[],template:'copyright',mode:'add'})).status,400);
 assert.equal((await fetch(base+`/api/captures/${foreign}/annotation-preview`)).status,404);assert.equal((await fetch(base+`/api/captures/${a}/annotation-preview`)).status,200);
 assert.equal((await pool.query('SELECT count(*)::int n FROM capture_history WHERE capture_id=$1',[a])).rows[0].n,2);
 const templateItems=[{t:'custom',text:'Inspect <here>',x:4,y:4,size:2,color:'#000000',font:'sans',outline:false},{t:'rect',x:10,y:10,w:40,h:30,thickness:.6,color:'#ff0000'},{t:'arrow',x:15,y:15,w:20,h:20,thickness:.8,color:'#1d4ed8',dir:'nw'},{t:'address',text:'Do not copy source address',x:4,y:12,size:2,color:'#000000'}];
 const create=body=>fetch(base+'/api/annotation-templates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 let saved=await create({name:'Inspection labels',overlays:templateItems});assert.equal(saved.status,200);saved=await saved.json();assert.equal(saved.overlays.length,4);assert.equal(saved.overlays[0].text,'Inspect <here>');assert.equal(saved.overlays[2].dir,'nw');assert.equal(saved.overlays[3].text,undefined,'dynamic address never copied');
 assert.equal((await create({name:'INSPECTION LABELS',overlays:templateItems})).status,409);assert.equal((await create({name:'Invalid',overlays:[{t:'custom',text:'x',x:Infinity,y:3}]})).status,400);
 assert.equal((await create({name:'Too many',overlays:Array.from({length:21},()=>templateItems[0])})).status,400);
 assert.equal((await(await fetch(base+'/api/annotation-templates',{headers:{'x-fixture-user':'other'}})).json()).length,0);
 assert.equal((await fetch(base+'/api/annotation-templates/'+saved.id,{method:'DELETE',headers:{'x-fixture-user':'other'}})).status,404);
 assert.equal((await fetch(base+'/api/captures/annotations',{method:'POST',headers:{'Content-Type':'application/json','x-fixture-user':'other'},body:JSON.stringify({ids:[foreign],template:'saved:'+saved.id,mode:'add'})})).status,404);
 r=await post({ids:[a,b],template:'saved:'+saved.id,mode:'add'});assert.equal(r.status,200);const applied=await get(a);assert.equal(applied.length,5);assert.deepEqual(applied.slice(1),saved.overlays);
 const stored=(await pool.query('SELECT overlays FROM annotation_templates WHERE id=$1',[saved.id])).rows[0].overlays;assert.deepEqual(stored,saved.overlays,'applying does not mutate saved definition');
 assert.equal((await fetch(base+'/api/annotation-templates/'+saved.id,{method:'DELETE'})).status,200);assert.deepEqual(await get(a),applied,'deletion leaves existing photo markings');assert.equal((await post({ids:[a],template:'saved:'+saved.id,mode:'add'})).status,404);
 const cascade=await(await create({name:'Account cleanup',overlays:templateItems})).json();await pool.query('DELETE FROM captures WHERE user_id=$1',[user]);await pool.query('DELETE FROM users WHERE id=$1',[user]);assert.equal((await pool.query('SELECT count(*)::int n FROM annotation_templates WHERE id=$1',[cascade.id])).rows[0].n,0);

 }finally{await new Promise(r=>server.close(r));await pool.query('DELETE FROM captures WHERE id=ANY($1::int[])',[ids]);await pool.query('DELETE FROM users WHERE id=ANY($1::int[])',[[user,other]]);await pool.end();}
});

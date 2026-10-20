const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path'),os=require('os');
const source=fs.readFileSync('server.js','utf8');
const slice=(from,to)=>{const a=source.indexOf(from);assert.ok(a>=0,from);const b=source.indexOf(to,a);assert.ok(b>a,to);return source.slice(a,b);};

test('offline capture time is kept only when it is believable',()=>{
  const ctx=vm.createContext({});vm.runInContext(slice('function deviceCaptureTime','\n')+'\n',ctx);
  const now=Date.parse('2026-10-17T12:00:00Z'),f=v=>ctx.deviceCaptureTime(v,now);
  assert.equal(f('2026-10-17T10:00:00Z'),'2026-10-17T10:00:00.000Z');
  assert.equal(f('2026-10-17T11:59:30Z'),null,'a just-taken photo keeps the server time');
  assert.equal(f('2026-10-18T12:00:00Z'),null,'future times are refused');
  assert.equal(f('2026-08-01T12:00:00Z'),null,'times older than 30 days are refused');
  assert.equal(f('not a date'),null);assert.equal(f(undefined),null);
});

test('ten wrong passwords pause sign-in for that email, and the pause expires',()=>{
  const limiter=require('../session-security').createLoginLimiter();
  const t=1_000_000;
  for(let i=0;i<9;i++)limiter.failure('a@example.test','203.0.113.1',t);
  assert.equal(limiter.blocked('a@example.test','203.0.113.2',t),false);
  limiter.failure('a@example.test','203.0.113.1',t);
  assert.equal(limiter.blocked('a@example.test','203.0.113.2',t),true);
  assert.equal(limiter.blocked('b@example.test','203.0.113.2',t),false,'other accounts are unaffected');
  assert.equal(limiter.blocked('a@example.test','203.0.113.2',t+15*60*1000+1),false);
  assert.match(source,/loginLimiter\.blocked\(email,req\.ip\)/);
});

test('one address guessing many emails is paused, and a flood of fake emails cannot clear a lockout',()=>{
  const limiter=require('../session-security').createLoginLimiter({ipLimit:50,maxEntries:100});
  const t=2_000_000;
  for(let i=0;i<50;i++)limiter.failure('user'+i+'@example.test','198.51.100.7',t);
  assert.equal(limiter.blocked('new@example.test','198.51.100.7',t),true,'the address is paused');
  assert.equal(limiter.blocked('new@example.test','198.51.100.8',t),false,'other addresses are unaffected');
  for(let i=0;i<10;i++)limiter.failure('victim@example.test','192.0.2.'+i,t);
  for(let i=0;i<5000;i++)limiter.failure('fake'+i+'@example.test','10.0.'+(i>>8)+'.'+(i&255),t+i);
  assert.equal(limiter.blocked('victim@example.test','192.0.2.200',t+6000),true,'an active lockout survives memory pressure');
  assert.ok(limiter.size('email')<=100&&limiter.size('ip')<=100,'memory stays capped');
  assert.equal(limiter.blocked('victim@example.test','192.0.2.200',t+15*60*1000+1),false,'the lockout still expires');
});

test('new passwords need at least 8 characters',()=>{
  const {passwordProblem}=require('../session-security');
  assert.match(passwordProblem('1234567'),/at least 8 characters/);
  assert.equal(passwordProblem('12345678'),null);
});

test('stored file paths cannot reach outside the uploads folder',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pn-uploads-'));fs.writeFileSync(path.join(dir,'a.jpg'),'x');
  const ctx=vm.createContext({path,fs,UPLOAD_DIR:dir});vm.runInContext(slice('function localPhoto','function slug'),ctx);
  assert.equal(ctx.localPhoto('/uploads/a.jpg'),path.join(dir,'a.jpg'));
  assert.equal(ctx.localPhoto('/uploads/../package.json'),null);
  assert.equal(ctx.localPhoto('/uploads/missing.jpg'),null);
  assert.equal(ctx.localPhoto(''),null);
});

test('deleting Photo Notes keeps files that something else still uses',async()=>{
  const removed=[],ctx=vm.createContext({require:id=>require('../'+id.slice(2)),UPLOAD_DIR:'/nowhere',console,fs:{promises:{unlink:async p=>{removed.push(p);}}},localPhoto:p=>'/disk'+p,
    pool:{query:async(sql)=>/information_schema/.test(sql)?{rows:[{table_name:'captures',column_name:'photo_path'},{table_name:'camera_readings',column_name:'photo_path'}]}:{rows:[{p:'/uploads/shared.jpg'}]}}});
  vm.runInContext(slice('let uploadPathColumns','// ---- delete selected captures ----'),ctx);
  await ctx.removeUnreferencedUploads(['/uploads/shared.jpg','/uploads/only.jpg',null,'/uploads/only.jpg']);
  assert.deepEqual(removed,['/disk/uploads/only.jpg','/nowhere/.thumbs/only.jpg.w480.jpg'],'the thumbnail goes with the photo');
});

test('when the reference check fails, no files are removed',async()=>{
  const removed=[],ctx=vm.createContext({require:id=>require('../'+id.slice(2)),UPLOAD_DIR:'/nowhere',console:{error(){}},fs:{promises:{unlink:async p=>{removed.push(p);}}},localPhoto:p=>p,pool:{query:async()=>{throw Error('down');}}});
  vm.runInContext(slice('let uploadPathColumns','// ---- delete selected captures ----'),ctx);
  await ctx.removeUnreferencedUploads(['/uploads/a.jpg']);assert.deepEqual(removed,[]);
});

test('database rollbacks never throw over the original error',()=>{
  for(const file of fs.readdirSync('.').filter(f=>f.endsWith('.js'))){
    const text=fs.readFileSync(file,'utf8');
    assert.equal(/\.query\((['"])ROLLBACK\1\)(?!\.catch)/.test(text),false,file+' has an unguarded ROLLBACK');
  }
});

test('queued photos know when they depend on a follow-up or incident link',()=>{
  const q=require('../public/capture-queue.js');
  assert.equal(q.linked({follow_up_occurrence_id:'4'}),true);
  assert.equal(q.linked({incident_id:'9',incident_view:'wide'}),true);
  assert.equal(q.linked({note:'plain'}),false);
  assert.equal(q.permanent(409),true,'other conflicts still stop for review');
});

test('a password reset ends sessions signed with the old password, and older sessions keep working',async()=>{
  const crypto=require('crypto');let row={id:1,active:true,role:'user',password_hash:'new-hash'},session;
  const ctx=vm.createContext({crypto,COOKIE:'c',SESSION_SECRET:'s',jwt:{verify:()=>session},pool:{query:async()=>({rows:[{...row}]})},
    require:id=>{assert.ok(['./ai-request-context','./session-security'].includes(id),id);return require('../'+id.slice(2));}});
  vm.runInContext(slice('function passwordVersion','function requireTestingQueueToken'),ctx);
  const attempt=async()=>{const res={statusCode:200,status(c){this.statusCode=c;return this},json(){return this}},req={cookies:{c:'t'}};let ok=false;await ctx.requireAuth(req,res,()=>ok=true);return {ok,req,res};};
  session={id:1,pv:ctx.passwordVersion('old-hash')};assert.equal((await attempt()).res.statusCode,401);
  session={id:1,pv:ctx.passwordVersion('new-hash')};const current=await attempt();assert.equal(current.ok,true);assert.equal('password_hash' in current.req.user,false);
  session={id:1};assert.equal((await attempt()).ok,true);
  row.session_revoked=true;assert.equal((await attempt()).res.statusCode,401,'a signed-out session stays signed out');
  delete row.session_revoked;session={id:1,sid:'abcdefghijklmnopqrstuv'};const fresh=await attempt();assert.equal(fresh.ok,true);assert.equal('session_revoked' in fresh.req.user,false);
});

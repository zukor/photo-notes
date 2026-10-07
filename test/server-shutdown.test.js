const test=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const path=require('node:path');
const helper=path.resolve(__dirname,'../server-shutdown');
for(const signal of ['SIGTERM','SIGINT'])test(`${signal} drains an active request and exits successfully`,async()=>{
  const child=spawn(process.execPath,['-e',`
    const http=require('node:http');
    const server=http.createServer((req,res)=>{
      console.log('active');
      setTimeout(()=>{res.end('done');console.log('drained');},150);
    }).listen(0,'127.0.0.1',()=>{
      require(${JSON.stringify(helper)}).installShutdown(server,{end:async()=>console.log('pool closed')});
      http.get('http://127.0.0.1:'+server.address().port,res=>res.resume());
    });
  `],{stdio:['ignore','pipe','pipe']});
  let output='',errors='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{errors+=data;});
  const completion=once(child,'exit');
  const deadline=setTimeout(()=>child.kill('SIGKILL'),5000);
  try {
    while(!output.includes('active'))await once(child.stdout,'data');
    child.kill(signal);
    const [code,exitSignal]=await completion;
    assert.equal(code,0,errors);assert.equal(exitSignal,null);
    assert.match(output,/drained/);assert.match(output,/pool closed/);assert.match(output,/shutdown\] complete/);
  }finally{clearTimeout(deadline);if(child.exitCode===null)child.kill('SIGKILL');}
});
test('Railway runs Node directly while preserving the Help start gate',()=>{
  const config=require('../railway.json');
  assert.equal(config.deploy.startCommand,'node scripts/help-coverage.cjs && exec node server.js');
});

test('Unexpected exceptions still exit with a failure',async()=>{
  const child=spawn(process.execPath,['-e',`
    const server=require('node:http').createServer().listen(0,'127.0.0.1',()=>{
      require(${JSON.stringify(helper)}).installShutdown(server,{end:async()=>{}});
      throw Error('unexpected fixture failure');
    });
  `],{stdio:'ignore'});
  const [code,signal]=await once(child,'exit');
  assert.equal(code,1);assert.equal(signal,null);
});

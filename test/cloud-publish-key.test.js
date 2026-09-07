const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{execFileSync,spawnSync}=require('node:child_process');
test('cloud publisher writes a usable OpenSSH key when secret transport strips the final newline',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pn-key-test-')),source=path.join(dir,'source'),keyFile=path.join(dir,'key');
 try{execFileSync('ssh-keygen',['-q','-t','ed25519','-N','','-f',source],{stdio:'ignore'});const secret=fs.readFileSync(source,'utf8').trimEnd();fs.writeFileSync(keyFile,secret,{mode:0o600});assert.notEqual(spawnSync('ssh-keygen',['-y','-f',keyFile],{stdio:'ignore'}).status,0);
 const code=fs.readFileSync('scripts/cloud/promote.mjs','utf8').split('\n').find(l=>l.startsWith('fs.writeFileSync(keyFile,'));vm.runInNewContext(code,{fs,keyFile,process:{env:{PHOTO_NOTES_DEPLOY_KEY:secret}}});assert.equal(spawnSync('ssh-keygen',['-y','-f',keyFile],{stdio:'ignore'}).status,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

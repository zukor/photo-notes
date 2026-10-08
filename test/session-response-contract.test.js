const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('real session response supplies the verified account ID required by app startup',async()=>{
 const server=fs.readFileSync(require.resolve('../server'),'utf8'),app=fs.readFileSync(require.resolve('../public/app.js'),'utf8');
 const start=server.indexOf("app.get('/api/me',"),end=server.indexOf('\n});',start)+4;
 let handler,payload;
 const context={app:{get(path,auth,fn){handler=fn;}},requireAuth(){},pool:{query:async()=>({rows:[{name:'Test account',email:'test@example.invalid',role:'admin',plan:'pro',pro_type:'general'}]})},require:()=>({allowed:()=>false}),isSuperAdmin:()=>true,editionAccess:()=>['pro'],normalizeProType:x=>x,currentFeatureAccess:async()=>({})};
 vm.runInNewContext(server.slice(start,end),context);
 await handler({user:{id:7}},{setHeader(){},json(data){payload=data;}});
 assert.equal(payload.id,7);assert.equal(payload.authed,true);
 const startup={AbortController,setTimeout,clearTimeout,api:async()=>({status:200,ok:true,json:async()=>payload})};vm.createContext(startup);
 vm.runInContext(app.slice(app.indexOf('async function loadStartupSession('),app.indexOf('async function boot(')),startup);
 assert.equal((await startup.loadStartupSession()).id,7);
});

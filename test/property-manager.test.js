const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('public/app.js','utf8'),server=fs.readFileSync('server.js','utf8');
test('Property Manager opens the HOA workflow with its own product name',()=>{
  const context=vm.createContext({state:{plan:'pro',proType:'property'}});
  for(const name of ['isProClient','isIssueReporterClient','isRoadIssuesClient','isGeneralProClient','isGeneralContractorClient','isHoaClient','productName']){
    vm.runInContext(app.match(new RegExp(`function ${name}\\(\\)\\s*\\{[^\\n]+`))[0],context);
  }
  assert.equal(vm.runInContext('isHoaClient()',context),true);
  assert.equal(vm.runInContext('productName()',context),'Property Manager Pro');
  context.state.proType='hoa';
  assert.equal(vm.runInContext('productName()',context),'HOA Maintenance Pro');
});
test('shared maintenance authorization permits both editions and rejects other products',async()=>{
  const context=vm.createContext({currentProduct:async()=>context.product,hoaCompanyForUser:async()=>({id:7})});
  vm.runInContext(server.match(/async function requireHoa\([^\n]+/)[0],context);
  for(const product of ['hoa','property','general']){
    context.product=product;let proceeded=false,code;
    const req={user:{id:1}},res={status(value){code=value;return this},json(){}};
    await context.requireHoa(req,res,()=>{proceeded=true});
    assert.equal(proceeded,product!=='general');
    if(proceeded)assert.equal(req.hoaCompany.id,7);else assert.equal(code,403);
  }
});

const {spawnSync}=require('node:child_process');
const path=require('node:path');
const result=spawnSync(process.execPath,[path.join(__dirname,'check-library-reconcile.cjs')],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
console.log('Approved flat Library workflow, responsive layout, selection and project/group organization PASS');

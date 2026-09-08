const assert=require('node:assert/strict'),fs=require('node:fs/promises');
(async()=>{
 const url=new URL(process.env.PN_IOS_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55487');assert.equal(url.pathname,'/pn_ios_test');
 process.env.DATABASE_URL=url.href;process.env.PGSSL='disable';process.env.UPLOAD_DIR='/tmp/pn-ios-local-api-uploads';
 const {pool}=require('../../db');const actual=(await pool.query('SHOW data_directory')).rows[0].data_directory;assert.equal(await fs.realpath(actual),await fs.realpath(process.env.PN_IOS_TEST_DATA_DIR));
 const {app}=require('../../server');const server=app.listen(33087,'127.0.0.1',()=>console.log('Disposable iOS test API: http://localhost:33087'));
 process.on('SIGTERM',()=>server.close(async()=>{await pool.end();process.exit(0);}));
})().catch(error=>{console.error(error.message);process.exit(1);});

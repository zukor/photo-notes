// A local-only API for browser acceptance checks. No production workers start.
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
(async()=>{
 const url=new URL(process.env.PN_WEB_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55487');assert.equal(url.pathname,'/pn_ios_test');
 const guard=new(require('pg').Client)({connectionString:url.href});await guard.connect();const actual=(await guard.query('SHOW data_directory')).rows[0].data_directory;assert.equal(await fs.realpath(actual),await fs.realpath(process.env.PN_WEB_TEST_DATA_DIR));await guard.end();
 process.env.DATABASE_URL=url.href;process.env.PGSSL='disable';process.env.UPLOAD_DIR='/tmp/pn-web-acceptance-uploads';process.env.ADMIN_EMAIL='ios-integration@example.invalid';process.env.ADMIN_PASSWORD='local-test-only';
 // Acceptance tests must never email testers or contact paid/external services.
 const originalFetch=global.fetch;global.fetch=(input,options)=>{const url=new URL(typeof input==='string'?input:input.url);if(!['localhost','127.0.0.1'].includes(url.hostname))throw Error('External requests disabled in acceptance tests');return originalFetch(input,options);};
 delete process.env.RESEND_API_KEY;delete process.env.ISSUE_GITHUB_TOKEN;
 const {pool,init}=require('../db');await init();await require('../issue-cloud').initCloud(pool);
 await pool.query("UPDATE users SET edition_access=ARRAY['basic','pro','contractor','roads','paving','hoa','concrete','roofer'] WHERE email='ios-integration@example.invalid'");
 const {app}=require('../server');const server=app.listen(33088,'127.0.0.1',()=>console.log('Disposable web test API: http://localhost:33088'));
 process.on('SIGTERM',()=>server.close(async()=>{await pool.end();process.exit(0);}));
})().catch(error=>{console.error(error.message);process.exit(1);});

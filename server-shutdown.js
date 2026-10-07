// Railway sends SIGTERM when replacing a healthy deployment.
// Drain existing requests and close database connections before a successful exit.
function installShutdown(server,pool,{timeoutMs=5000}={}) {
  let stopping=false;
  const shutdown=signal=>{
    if(stopping)return;
    stopping=true;
    console.info(`[shutdown] ${signal}: draining requests`);
    const deadline=setTimeout(()=>{
      console.info('[shutdown] drain deadline reached; stopping');
      process.exit(0);
    },timeoutMs);
    server.keepAliveTimeout=1;
    server.close(async()=>{
      try {await pool.end();} catch(error) {console.error('[shutdown] database close failed',error.message);}
      clearTimeout(deadline);
      console.info('[shutdown] complete');
      process.exit(0);
    });
    server.closeIdleConnections?.();
  };
  process.on('SIGTERM',shutdown);
  process.on('SIGINT',shutdown);
}
module.exports={installShutdown};

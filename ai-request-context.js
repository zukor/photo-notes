const {AsyncLocalStorage}=require('node:async_hooks');
// Server-authenticated identity follows asynchronous AI adapters without shared mutable state.
module.exports=new AsyncLocalStorage();

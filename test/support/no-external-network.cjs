'use strict';
// Loaded only by the test gate. Mocked provider clients remain injectable.
const allowed=hostname=>['localhost','127.0.0.1','::1','[::1]'].includes(hostname);
const originalFetch=global.fetch;
global.fetch=(input,...args)=>{const value=typeof input==='string'||input instanceof URL?input:input.url;const url=new URL(value);if(!allowed(url.hostname))throw Error('Automated tests prohibit external requests: '+url.hostname);return originalFetch(input,...args);};
for(const moduleName of ['node:http','node:https']){const module=require(moduleName);for(const key of ['request','get']){const original=module[key];module[key]=function(input,...args){const hostname=typeof input==='string'||input instanceof URL?new URL(input).hostname:input.hostname||input.host||'localhost';if(!allowed(hostname.split(':')[0])&&!allowed(hostname))throw Error('Automated tests prohibit external requests: '+hostname);return original.call(this,input,...args);};}}

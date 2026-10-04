'use strict';
const assert=require('node:assert/strict');
function assertIsolated(url){const target=new URL(url);assert(['localhost','127.0.0.1'].includes(target.hostname),'local test database required');assert(process.env.PN_AUTOMATION_DATA_DIR,'runner-owned database directory required');assert.equal(target.searchParams.get('host'),process.env.PN_AUTOMATION_DATA_DIR,'private test socket required');}
module.exports={assertIsolated};

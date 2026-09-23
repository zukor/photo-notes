const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('public/issue-reporter.js','utf8');
function setup(permission,existing=false){
 const calls=[];const subscription={toJSON:()=>({endpoint:'https://example.test/push'})};
 const context=vm.createContext({Date,window:{Notification:{},PushManager:{}},Notification:{permission,requestPermission(){throw Error('Must not request permission automatically');}},navigator:{serviceWorker:{getRegistration:async()=>({pushManager:{getSubscription:async()=>existing?subscription:null,subscribe:async()=>{calls.push('subscribe');return subscription;}}})}},api:async path=>{calls.push(path);return {ok:true,json:async()=>({publicKey:'test'})};}});
 vm.runInContext(source.slice(source.indexOf('let issuePushSyncPending'),source.indexOf('function issueNotificationControls()')),context);
 return {calls,sync:()=>vm.runInContext('syncIssuePushNotifications()',context)};
}
test('permitted browser push registers automatically without prompting and throttles repeat checks',async()=>{const h=setup('granted');await h.sync();await h.sync();assert.deepEqual(h.calls,['/api/issues/push-key','subscribe','/api/issues/push-subscription']);});
test('existing subscription is restored to server without resubscribing',async()=>{const h=setup('granted',true);await h.sync();assert.deepEqual(h.calls,['/api/issues/push-subscription']);});
test('default and denied permission never trigger prompts or push requests',async()=>{for(const permission of ['default','denied']){const h=setup(permission);await h.sync();assert.deepEqual(h.calls,[]);}});

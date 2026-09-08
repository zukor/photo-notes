const http2=require('node:http2');
const jwt=require('jsonwebtoken');
const webpush=require('web-push');
let cachedProviderToken=null;
function ready(env=process.env){return !!(env.APNS_KEY_ID&&env.APNS_TEAM_ID&&env.APNS_PRIVATE_KEY&&env.APNS_TOPIC);}
function validDevice(value){return value&&/^[a-f0-9]{64,200}$/i.test(value.token||'')&&['development','production'].includes(value.environment);}
function applePayload(message){const data=typeof message==='string'?JSON.parse(message):message;return {aps:{alert:{title:String(data.title||'Photo Notes').slice(0,100),body:String(data.body||'An issue report has an update.').slice(0,400)},sound:'default','thread-id':'photo-notes-issues'},url:'/?issues=1'};}
async function sendApple(subscription,payload,{env=process.env,connect=http2.connect}={}){
 if(!ready(env))throw Object.assign(Error('Apple notifications are not configured'),{statusCode:503});
 if(!validDevice(subscription))throw Object.assign(Error('Invalid Apple device'),{statusCode:410});
 const now=Date.now();
 if(!cachedProviderToken||cachedProviderToken.key!==env.APNS_PRIVATE_KEY||cachedProviderToken.team!==env.APNS_TEAM_ID||cachedProviderToken.id!==env.APNS_KEY_ID||now-cachedProviderToken.at>25*60000)cachedProviderToken={key:env.APNS_PRIVATE_KEY,team:env.APNS_TEAM_ID,id:env.APNS_KEY_ID,at:now,token:jwt.sign({},env.APNS_PRIVATE_KEY.replace(/\\n/g,'\n'),{algorithm:'ES256',issuer:env.APNS_TEAM_ID,keyid:env.APNS_KEY_ID})};
 const token=cachedProviderToken.token;
 const host=subscription.environment==='development'?'https://api.sandbox.push.apple.com':'https://api.push.apple.com';
 const client=connect(host);
 try{return await new Promise((resolve,reject)=>{
  let settled=false;const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result);};
  const timer=setTimeout(()=>{finish(Object.assign(Error('Apple delivery timed out'),{statusCode:503}));client.destroy();},10000);
  client.on('error',()=>finish(Object.assign(Error('Apple connection failed'),{statusCode:503})));
  const request=client.request({':method':'POST',':path':`/3/device/${subscription.token}`,authorization:`bearer ${token}`,'apns-topic':subscription.environment==='development'?(env.APNS_DEVELOPMENT_TOPIC||'com.zukor.photonotes.dev'):env.APNS_TOPIC,'apns-push-type':'alert','apns-priority':'10','apns-expiration':String(Math.floor(Date.now()/1000)+86400)});
  let status=0,body='';request.on('response',headers=>{status=Number(headers[':status']);});request.on('data',chunk=>{if(body.length<2048)body+=chunk;});request.on('error',()=>finish(Object.assign(Error('Apple request failed'),{statusCode:503})));
  request.on('end',()=>{if(status===200)return finish(null,{statusCode:200});let reason;try{reason=JSON.parse(body).reason;}catch{}finish(Object.assign(Error('Apple delivery rejected'),{statusCode:reason==='Unregistered'||reason==='BadDeviceToken'?410:status||503}));});
  request.end(JSON.stringify(applePayload(payload)));
 });}finally{client.close();}
}
function sendIssueNotification(subscription,payload,options){return subscription?.native==='apns'?sendApple(subscription,payload):webpush.sendNotification(subscription,payload,options);}
function registerIOSPush(app,{pool,requireAuth}){
 app.get('/api/issues/ios-push-status',requireAuth,(_req,res)=>res.json({configured:ready()}));
 app.post('/api/issues/ios-push-subscription',requireAuth,async(req,res)=>{
  if(!ready())return res.status(503).json({error:'Apple notifications need configuration. Issue updates remain available inside Photo Notes.'});
  if(!validDevice(req.body))return res.status(400).json({error:'Invalid iPhone notification registration'});
  const sub={native:'apns',token:req.body.token.toLowerCase(),environment:req.body.environment};const endpoint=`apns:${sub.environment}:${sub.token}`;
  try{await pool.query('INSERT INTO issue_push_subscriptions(user_id,endpoint,subscription) VALUES($1,$2,$3) ON CONFLICT(endpoint) DO UPDATE SET user_id=EXCLUDED.user_id,subscription=EXCLUDED.subscription,created_at=now()',[req.user.id,endpoint,JSON.stringify(sub)]);res.json({ok:true});}catch{res.status(503).json({error:'Notification registration could not be saved'});}
 });
 app.delete('/api/issues/ios-push-subscription',requireAuth,async(req,res)=>{if(!validDevice(req.body))return res.status(400).json({error:'Invalid registration'});try{await pool.query('DELETE FROM issue_push_subscriptions WHERE user_id=$1 AND endpoint=$2',[req.user.id,`apns:${req.body.environment}:${req.body.token.toLowerCase()}`]);res.json({ok:true});}catch{res.status(503).json({error:'Notification registration could not be removed'});}});
}
module.exports={ready,validDevice,applePayload,sendApple,sendIssueNotification,registerIOSPush};

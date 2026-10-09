// Content-free usage telemetry. Identity always comes from the authenticated session.
function registerUserUsage(app,{pool,requireAuth,requireAdmin}){
  app.post('/api/usage/pulse',requireAuth,async(req,res)=>{
    const b=req.body||{};
    if(!/^[a-z0-9-]{1,64}$/.test(b.screen||'')||!/^[a-z0-9-]{1,40}$/.test(b.edition||'')||!/^[a-f0-9-]{36}$/.test(b.session||'')||!Number.isInteger(b.seconds)||b.seconds<0||b.seconds>30)return res.status(400).json({error:'Invalid usage pulse'});
    try{
      await pool.query(`INSERT INTO events(user_id,action,detail) VALUES($1,'usage_pulse',$2)`,[req.user.id,JSON.stringify({screen:b.screen,edition:b.edition,session:b.session,seconds:b.seconds,visit:b.visit===true})]);
      res.json({ok:true});
    }catch(e){res.status(503).json({error:'Usage unavailable'});}
  });
  app.get('/api/admin/user-usage',requireAdmin,async(req,res)=>{
    const days=Math.min(90,Math.max(1,parseInt(req.query.days,10)||7));
    const user=Number(req.query.user)||null;
    try{
      const params=[days,user];
      const filter=`e.created_at >= now()-($1::int*interval '1 day') AND ($2::int IS NULL OR e.user_id=$2)`;
      const users=(await pool.query(`SELECT u.id,u.name,u.email,COUNT(*) FILTER(WHERE e.action='login')::int logins,MAX(e.created_at) last_activity,COALESCE(SUM((e.detail->>'seconds')::int) FILTER(WHERE e.action='usage_pulse'),0)::int active_seconds,COUNT(DISTINCT e.detail->>'session') FILTER(WHERE e.action='usage_pulse')::int sessions,COUNT(*) FILTER(WHERE e.action<>'usage_pulse' AND e.action<>'login')::int actions FROM users u LEFT JOIN events e ON e.user_id=u.id AND ${filter} WHERE ($2::int IS NULL OR u.id=$2) GROUP BY u.id ORDER BY active_seconds DESC,u.name`,params)).rows;
      const screens=(await pool.query(`SELECT e.user_id,e.detail->>'screen' screen,e.detail->>'edition' edition,SUM((e.detail->>'seconds')::int)::int active_seconds,COUNT(*) FILTER(WHERE e.detail->>'visit'='true')::int visits FROM events e WHERE ${filter} AND e.action='usage_pulse' GROUP BY e.user_id,e.detail->>'screen',e.detail->>'edition' ORDER BY active_seconds DESC LIMIT 1000`,params)).rows;
      const actions=(await pool.query(`SELECT e.user_id,e.action,COUNT(*)::int count FROM events e WHERE ${filter} AND e.action NOT IN ('usage_pulse','login') GROUP BY e.user_id,e.action ORDER BY count DESC LIMIT 1000`,params)).rows;
      const recent=(await pool.query(`SELECT e.user_id,e.action,e.created_at,e.detail->>'screen' screen FROM events e WHERE ${filter} AND (e.action<>'usage_pulse' OR e.detail->>'visit'='true') ORDER BY e.created_at DESC LIMIT 100`,params)).rows;
      const sessions=(await pool.query(`SELECT e.user_id,e.detail->>'session' session,MIN(e.created_at) started_at,MAX(e.created_at) last_seen,SUM((e.detail->>'seconds')::int)::int active_seconds FROM events e WHERE ${filter} AND e.action='usage_pulse' GROUP BY e.user_id,e.detail->>'session' ORDER BY started_at DESC LIMIT 100`,params)).rows;
      res.json({days,users,screens,actions,recent,sessions});
    }catch(e){console.error('[user-usage]',e);res.status(500).json({error:'Usage could not be loaded'});}
  });
}
module.exports={registerUserUsage};

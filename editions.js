const EDITIONS = Object.freeze({
  basic:{plan:'free',pro_type:'general',label:'Photo Notes Basic'},
  pro:{plan:'pro',pro_type:'general',label:'Photo Notes Pro'},
  contractor:{plan:'pro',pro_type:'contractor',label:'General Contractor Pro'},
  roads:{plan:'free',pro_type:'roads',label:'Road Issue Reporter'},
  paving:{plan:'pro',pro_type:'paving',label:'Paving Pro'},
  hoa:{plan:'pro',pro_type:'hoa',label:'HOA Maintenance Pro'},
  concrete:{plan:'pro',pro_type:'concrete',label:'Concrete Pro'},
  roofer:{plan:'pro',pro_type:'roofer',label:'Roofer Pro'}
});
function currentEdition(user) {
  if(user.plan!=='pro')return user.pro_type==='roads'?'roads':'basic';
  return user.pro_type==='general'?'pro':Object.hasOwn(EDITIONS,user.pro_type)?user.pro_type:'paving';
}
function editionAccess(user) {
  return Array.isArray(user.edition_access)?user.edition_access.filter(k=>Object.hasOwn(EDITIONS,k)):
    user.role==='admin'?Object.keys(EDITIONS):[currentEdition(user)];
}
function validateEditions(value) {
  if(!Array.isArray(value)||!value.length||value.some(k=>typeof k!=='string'||!Object.hasOwn(EDITIONS,k)))return null;
  return [...new Set(value)];
}
function registerEditionRoutes(app,{pool,requireAuth,requireAdmin,setSession,logEvent}) {
  async function switchEdition(req,res){
    const key=req.body&&req.body.edition;
    if(!Object.hasOwn(EDITIONS,key))return res.status(400).json({error:'Choose a valid version'});
    let client;
    try{
      client=await pool.connect();await client.query('BEGIN');
      const user=(await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[req.user.id])).rows[0];
      if(!user||!user.active||!editionAccess(user).includes(key)){
        await client.query('ROLLBACK');return res.status(403).json({error:'This version is not enabled for your account'});
      }
      const choice=EDITIONS[key];
      const updated=(await client.query('UPDATE users SET plan=$1,pro_type=$2 WHERE id=$3 RETURNING *',[choice.plan,choice.pro_type,user.id])).rows[0];
      await client.query('COMMIT');setSession(res,updated);
      await logEvent(user.id,'edition_switch',{edition:key});
      res.json({ok:true,edition:key});
    }catch(e){if(client)await client.query('ROLLBACK');res.status(500).json({error:'Version could not be switched'});}
    finally{if(client)client.release();}
  }
  app.post('/api/switch-edition',requireAuth,switchEdition);
  // Existing clients use this URL; it observes the same saved access list.
  app.post('/api/admin/switch-edition',requireAdmin,switchEdition);
  app.post('/api/admin/users/:id/versions',requireAdmin,async(req,res)=>{
    const access=validateEditions(req.body&&req.body.edition_access),id=Number(req.params.id);
    if(!access||!Number.isInteger(id)||id<1)return res.status(400).json({error:'Select at least one valid version'});
    let client;
    try{
      client=await pool.connect();await client.query('BEGIN');
      const user=(await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!user){await client.query('ROLLBACK');return res.status(404).json({error:'User not found'});}
      const selected=access.includes(currentEdition(user))?currentEdition(user):access[0],choice=EDITIONS[selected];
      await client.query('UPDATE users SET edition_access=$1,plan=$2,pro_type=$3 WHERE id=$4',[access,choice.plan,choice.pro_type,id]);
      await client.query('COMMIT');
      await logEvent(req.user.id,'admin_user_update',{target_user_id:id,fields:['edition_access'],edition_access:access});
      res.json({ok:true,edition_access:access,selected_edition:selected});
    }catch(e){if(client)await client.query('ROLLBACK');res.status(500).json({error:'Version access could not be saved'});}
    finally{if(client)client.release();}
  });
}
module.exports={EDITIONS,currentEdition,editionAccess,validateEditions,registerEditionRoutes};

// Super Admin membership is managed in server configuration, never through user edits.
function superAdminIds(env=process.env){
  return new Set(String(env.SUPER_ADMIN_USER_IDS||'').split(',').map(id=>id.trim()).filter(id=>/^[1-9]\d*$/.test(id)));
}
function isSuperAdmin(user,env=process.env){
  return !!user&&user.role==='admin'&&superAdminIds(env).has(String(user.id));
}
function adminAccessBoundary(env=process.env){
  return (req,res,next)=>{
    let path;
    try{path=decodeURIComponent(req.path).toLowerCase();}catch{return res.status(400).json({error:'Invalid path'});}
    const restricted=/^\/(?:issues(?:\/|$)|billing(?:\/|$)|health\/?$|activity\/?$|repair-status\/?$|cloud-worker\/?$)/.test(path);
    const target=path.match(/^\/users\/([^/]+)(?:\/|$)/);
    const protectedAccount=target&&superAdminIds(env).has(String(parseInt(target[1],10)));
    const userRoute=/^\/users(?:\/|$)/.test(path);
    const versionUpdate=req.method==='POST'&&/^\/users\/[^/]+\/versions\/?$/.test(path);
    const userMutation=userRoute&&!['GET','HEAD','OPTIONS'].includes(req.method)&&!versionUpdate;
    const deletionPreview=userRoute&&/\/deletion\/?$/.test(path);
    if((restricted||protectedAccount||userMutation||deletionPreview)&&!isSuperAdmin(req.user,env))return res.status(403).json({error:'Super Admin access required'});
    if(req.body&&Object.prototype.hasOwnProperty.call(req.body,'is_super_admin'))return res.status(403).json({error:'Super Admin membership is managed in server configuration'});
    next();
  };
}
module.exports={isSuperAdmin,adminAccessBoundary};

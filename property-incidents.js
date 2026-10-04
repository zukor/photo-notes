'use strict';
const TYPES=['Vehicle Impact','Vandalism','Weather / Storm Damage','Water / Leak','Building Damage','Equipment Damage','Landscaping / Tree Damage','Tenant-Related Damage','Contractor-Related Damage','Other'];
const VIEWS=['Overview','Damage','Close-Up','Surrounding Area','Identification','Additional Photos'];
const EVIDENCE='Photographs document visible conditions when captured or received. Reported incident time and party information are user-entered context. This record does not independently establish cause, incident time, liability, repair cost, coverage, or legal responsibility.';
const SCHEMA=`CREATE TABLE IF NOT EXISTS property_incidents (
 id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES hoa_management_companies(id),
 community_id INTEGER NOT NULL REFERENCES hoa_communities(id), created_by INTEGER NOT NULL REFERENCES users(id),
 asset_id INTEGER REFERENCES hoa_assets(id), property_area_id INTEGER REFERENCES property_areas(id), area_name TEXT,
 title TEXT NOT NULL, incident_type TEXT NOT NULL, other_type TEXT,
 observed_at TIMESTAMPTZ NOT NULL, reported_at TIMESTAMPTZ,
 description TEXT, reported_by TEXT, observed_by TEXT, other_party TEXT, reference_numbers TEXT, immediate_actions TEXT,
 status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','Documented','Closed')),
 skipped_views JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS property_incidents_owner_idx ON property_incidents(created_by,company_id);
CREATE INDEX IF NOT EXISTS property_incidents_area_idx ON property_incidents(property_area_id) WHERE property_area_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS property_incident_photos (
 incident_id INTEGER NOT NULL REFERENCES property_incidents(id) ON DELETE CASCADE,
 capture_id INTEGER NOT NULL UNIQUE REFERENCES captures(id) ON DELETE CASCADE,
 view_name TEXT NOT NULL, linked_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(incident_id,capture_id)
);`;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
function normalize(b){
 const out={};for(const key of ['title','incident_type','other_type','area_name','description','reported_by','observed_by','other_party','reference_numbers','immediate_actions'])out[key]=String(b[key]||'').trim().slice(0,['description','immediate_actions'].includes(key)?8000:1000);
 if(!out.title)fail('Incident Title required');if(!TYPES.includes(out.incident_type))fail('Select an Incident Type');if(out.incident_type==='Other'&&!out.other_type)fail('Describe the Other incident type');
 for(const key of ['observed_at','reported_at']){if(!b[key]){if(key==='observed_at')fail('Observed/Documented Time required');out[key]=null;}else{const date=new Date(b[key]);if(!Number.isFinite(date.getTime()))fail('Invalid date/time');out[key]=date.toISOString();}}
 out.status=b.status||'Open';if(!['Open','Documented','Closed'].includes(out.status))fail('Invalid status');
 out.skipped_views={};for(const [view,reason] of Object.entries(b.skipped_views||{})){if(!VIEWS.slice(0,5).includes(view)||typeof reason!=='string'||!reason.trim())fail('A skipped view needs a reason');out.skipped_views[view]=reason.trim().slice(0,1000);}
 return out;
}
async function owned(db,user,company,id){const row=(await db.query('SELECT * FROM property_incidents WHERE id=$1 AND created_by=$2 AND company_id=$3',[id,user,company])).rows[0];if(!row)fail('Incident not found',404);return row;}
async function linkCapture(db,{userId,product,companyId,incidentId,captureId,view,hasPhoto}){
 if(product!=='property')fail('Property Manager Pro required',403);if(!hasPhoto)fail('An incident view requires a photograph');if(!VIEWS.includes(view))fail('Invalid photographic view');
 const incident=await owned(db,userId,companyId,Number(incidentId));
 await db.query('INSERT INTO property_incident_photos(incident_id,capture_id,view_name) VALUES($1,$2,$3)',[incident.id,captureId,view]);
 await db.query("UPDATE property_incidents SET skipped_views=skipped_views-$1,updated_at=now() WHERE id=$2",[view,incident.id]);
 return incident;
}
function register(app,deps){
 const {pool,requireAuth,requireHoa,currentProduct,report}=deps;
 const gate=async(req,res,next)=>{try{if(await currentProduct(req.user.id)!=='property')return res.status(403).json({error:'Property Manager Pro required'});next();}catch(e){next(e);}};
 const run=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){console.error('[property.incidents]',e.message);if(!res.headersSent)res.status(e.status||500).json({error:e.status?e.message:'Incident operation failed'});}};
 const route=(method,url,fn)=>app[method](url,requireAuth,requireHoa,gate,run(fn));
 const detail=async(req)=>{const incident=await owned(pool,req.user.id,req.hoaCompany.id,Number(req.params.id));const context=(await pool.query('SELECT c.name property_name,c.address property_address,a.name asset_name FROM hoa_communities c LEFT JOIN hoa_assets a ON a.id=$2 AND a.company_id=c.company_id WHERE c.id=$1 AND c.company_id=$3',[incident.community_id,incident.asset_id,req.hoaCompany.id])).rows[0];const photos=(await pool.query('SELECT c.*,p.view_name,p.linked_at FROM property_incident_photos p JOIN captures c ON c.id=p.capture_id AND c.user_id=$2 WHERE p.incident_id=$1 ORDER BY p.linked_at,c.id',[incident.id,req.user.id])).rows;photos.sort((a,b)=>VIEWS.indexOf(a.view_name)-VIEWS.indexOf(b.view_name));return {incident:{...incident,...context},photos};};
 route('get','/api/property/incidents',async(req,res)=>res.json((await pool.query('SELECT i.*,c.name property_name,(SELECT count(*)::int FROM property_incident_photos p WHERE p.incident_id=i.id) photo_count FROM property_incidents i JOIN hoa_communities c ON c.id=i.community_id WHERE i.company_id=$1 AND i.created_by=$2 ORDER BY i.updated_at DESC',[req.hoaCompany.id,req.user.id])).rows));
 const save=async(req,res)=>{const b=req.body||{},data=normalize(b),existing=req.params.id?await owned(pool,req.user.id,req.hoaCompany.id,Number(req.params.id)):null;
 const community=existing?existing.community_id:Number(b.community_id);
 if(!(await pool.query('SELECT id FROM hoa_communities WHERE id=$1 AND company_id=$2',[community,req.hoaCompany.id])).rowCount)fail('Select a Property');
 const asset=b.asset_id?Number(b.asset_id):null;if(asset&&!(await pool.query('SELECT id FROM hoa_assets WHERE id=$1 AND community_id=$2 AND company_id=$3',[asset,community,req.hoaCompany.id])).rowCount)fail('Asset must belong to the selected Property');
 let area=b.property_area_id?Number(b.property_area_id):null;if(area){if(!(await pool.query("SELECT to_regclass('property_areas') available")).rows[0].available)fail('Areas are not available');const a=(await pool.query('SELECT name FROM property_areas WHERE id=$1 AND community_id=$2 AND (active=true OR id=$3)',[area,community,existing?.property_area_id||null])).rows[0];if(!a)fail('Select an Area belonging to this Property');data.area_name=a.name;}
 Object.assign(data,{asset_id:asset,property_area_id:area});data.skipped_views=JSON.stringify(data.skipped_views);
 const keys=Object.keys(data),values=Object.values(data);let row;
 if(existing){values.push(existing.id,req.user.id,req.hoaCompany.id);row=(await pool.query(`UPDATE property_incidents SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')},updated_at=now() WHERE id=$${values.length-2} AND created_by=$${values.length-1} AND company_id=$${values.length} RETURNING *`,values)).rows[0];}
 else{Object.assign(data,{community_id:community,created_by:req.user.id,company_id:req.hoaCompany.id});const k=Object.keys(data);row=(await pool.query(`INSERT INTO property_incidents(${k.join(',')}) VALUES(${k.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,Object.values(data))).rows[0];}res.json(row);};
 route('post','/api/property/incidents',save);route('post','/api/property/incidents/:id',save);
 route('get','/api/property/incidents/:id',async(req,res)=>res.json(await detail(req)));
 route('get','/api/property/incidents/:id/report',async(req,res)=>{const d=await detail(req);await report(req,res,d,EVIDENCE,VIEWS);});
}
module.exports={SCHEMA,TYPES,VIEWS,EVIDENCE,normalize,linkCapture,register};

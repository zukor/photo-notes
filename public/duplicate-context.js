/* One-time context reuse. This allowlist never accepts photo evidence or relationships. */
(function(root){
'use strict';
const editions=['pro','paving','concrete','property','hoa','contractor','roofer'];
function context(source,edition,copyNotes=false){
  if(!editions.includes(edition))throw Error('Context reuse requires a supported Pro edition');
  const result={sourceId:Number(source.id),topics:Array.isArray(source.area_tags)?source.area_tags.filter(x=>typeof x==='string').slice():[],jobId:source.job_id?String(source.job_id):'',note:copyNotes?String(source.note||''):''};
  if(edition==='concrete')result.concrete={phase:source.concrete_phase||'',purpose:source.concrete_purpose||'',element:source.concrete_element||'',jobId:result.jobId,detailsOpen:true};
  if(['hoa','property'].includes(edition))result.property={communityId:String(source.property_community_id||source.duplicate_community_id||''),areaId:edition==='property'?String(source.property_area_id||''):'',category:source.duplicate_category||result.topics[0]||'',recordType:source.duplicate_record_type||'maintenance'};
  return result;
}
const exported={editions,context};
if(typeof module==='object'&&module.exports)module.exports=exported;
else root.PhotoNotesDuplicate=exported;
})(typeof window==='object'?window:globalThis);

(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.PhotoNotesScannerAvailability=api;})(typeof globalThis==='object'?globalThis:this,()=>{
 const industry=['contractor','paving','concrete','hoa','property','roofer'];
 const editions={plan_sketch:industry,business_card:industry,equipment_plate:['contractor','paving','concrete','hoa','property'],material_label:industry,gauge:['contractor','paving','concrete','hoa','property']};
 return {allowed:(edition,type)=>!!editions[type]?.includes(edition==='asphalt'?'paving':edition),reportTypes:['plan_sketch','business_card','equipment_plate','material_label','gauge']};
});

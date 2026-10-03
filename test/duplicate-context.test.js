const test=require('node:test');
const assert=require('node:assert/strict');
const {context,editions}=require('../public/duplicate-context');
const source={id:12,area_tags:['Pavement','West'],job_id:4,note:'Old crack',photo_path:'/old.jpg',original_sha256:'old',created_at:'yesterday',latitude:1,longitude:2,address:'Old location',ai:'old',dim_length:7,defect_type:'crack',favorite:true,flagged:true,group_id:9,related_ids:[1],concrete_phase:'work',concrete_purpose:'work_progress',concrete_element:'patio',concrete_condition:'unsafe',concrete_severity:'critical',concrete_mix:'old',property_community_id:3,property_area_id:8,duplicate_category:'Lighting',duplicate_record_type:'inspection',status:'completed'};
for(const edition of editions)test(`${edition}: context allowlist excludes evidence, findings and relationships`,()=>{
 const d=context(source,edition);
 assert.equal(d.note,'');assert.equal(d.jobId,'4');assert.equal(d.sourceId,12);
 assert.deepEqual(Object.keys(d).sort(),['sourceId','topics','jobId','note',...(edition==='concrete'?['concrete']:[]),...(['hoa','property'].includes(edition)?['property']:[])].sort());
 if(edition==='concrete')assert.deepEqual(d.concrete,{phase:'work',purpose:'work_progress',element:'patio',jobId:'4',detailsOpen:true});
 if(d.property)assert.deepEqual(d.property,{communityId:'3',areaId:edition==='property'?'8':'',category:'Lighting',recordType:'inspection'});
 d.topics.push('new');assert.deepEqual(source.area_tags,['Pavement','West']);
});
test('notes require deliberate opt-in',()=>assert.equal(context(source,'pro',true).note,'Old crack'));
for(const edition of ['basic','issue','roads'])test(`${edition} cannot reuse context`,()=>assert.throws(()=>context(source,edition)));

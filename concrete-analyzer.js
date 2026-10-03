const {elements}=require('./public/concrete-capture');
const conditions=['not_assessed','acceptable','monitor','repair_needed','unsafe'];
const severities=['none','minor','moderate','severe','critical'];
const findingTypes=['cracking','spalling','scaling','surface_deterioration','exposed_aggregate','staining','apparent_displacement','chipped_edge','joint_deterioration','surface_damage','other','no_obvious_defect'];
const confidence=['high','medium','low'];
function normalize(d,{review=false}={}){
 const valid=d&&Object.hasOwn(elements,d.element)&&conditions.includes(d.condition)&&severities.includes(d.severity)&&confidence.includes(d.confidence)&&Array.isArray(d.findings)&&d.findings.length>0&&d.findings.length<=8;
 if(!valid)throw new Error('Invalid analysis fields');
 const text=v=>{if(typeof v!=='string'||!v.trim()||v.length>600)throw new Error('Invalid visible observation');return v.trim();};
 const findings=d.findings.map(f=>{if(!f||!findingTypes.includes(f.type)||!confidence.includes(f.confidence))throw new Error('Invalid finding');return {type:f.type,observation:text(f.observation),confidence:f.confidence};});
 if(findings.length>1&&findings.some(f=>f.type==='no_obvious_defect'))throw new Error('Conflicting findings');
 if(!review&&(d.condition==='unsafe'||d.severity==='critical'))throw new Error('Professional determination is not supported');
 return {element:d.element,condition:d.condition,severity:d.severity,confidence:d.confidence,observation:text(d.observation),findings};
}
const prompt=`Document only visible evidence in this concrete photograph. Return ONLY JSON:
{"element":"other","condition":"not_assessed","severity":"none","confidence":"low","observation":"concise factual visible observation","findings":[{"type":"other","observation":"concise visible finding","confidence":"low"}]}.
Element values: ${Object.keys(elements).join(', ')}. Use other when unclear.
Condition values: not_assessed, acceptable, monitor, repair_needed. These are suggested documentation statuses, not defect types. Use not_assessed when uncertain. Do not certify acceptability.
Severity values: none (not rated), minor, moderate, severe. Suggest severity only from visible extent; use none when uncertain.
Finding types: ${findingTypes.join(', ')}. Return 1 to 8 distinct visible findings, or no_obvious_defect alone. Confidence values: high, medium, low for interpretation, never engineering certainty.
No engineering or structural diagnosis, safety/code certification, cause claims, repair recommendations, measurements, geographic/exact location or mix/specification guesses (PSI, reinforcement, batch, admixtures, curing). Do not infer hidden conditions. If concrete is absent or unclear, use other/not_assessed/none/low and describe the limitation. Observation at most two short sentences. Each finding at most one sentence.`;
module.exports={id:'concrete',version:'1.0.0',elements,conditions,severities,findingTypes,confidence,prompt,normalize};
// Domain-owned review mapping. The shared service never assumes Concrete fields.
module.exports.reviewFields={element:'concrete_element',condition:'concrete_condition',severity:'concrete_severity'};
module.exports.schema={title:'Concrete Visual Analysis',elements,conditions,severities,findingTypes,fields:{element:{label:'Element',column:'concrete_element',options:elements},condition:{label:'Condition',column:'concrete_condition',options:Object.fromEntries(conditions.map(v=>[v,v.replaceAll('_',' ')]))},severity:{label:'Severity',column:'concrete_severity',options:Object.fromEntries(severities.map(v=>[v,v.replaceAll('_',' ')]))}}};
module.exports.applyReview=async(client,photo,userId,result,apply)=>client.query(`UPDATE captures SET concrete_element=$3,concrete_condition=$4,concrete_severity=$5,concrete_reviewed_observation=$6 WHERE id=$1 AND user_id=$2`,[photo.id,userId,apply.includes('element')?result.element:photo.concrete_element,apply.includes('condition')?result.condition:photo.concrete_condition,apply.includes('severity')?result.severity:photo.concrete_severity,result.observation]);

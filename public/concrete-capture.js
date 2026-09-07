(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ConcreteCapture=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const phases=[
    {id:'proposal',label:'Before the proposal',hint:'Photograph the space and what the customer wants, even when no concrete exists yet.',purposes:[
      ['proposed_area','Proposed patio, driveway, or sidewalk','Show the whole area and where the new concrete could go.','existing_condition'],
      ['existing_condition','Existing conditions or damage','Record what is already there, including any problem the customer wants fixed.','existing_condition'],
      ['layout_dimensions','Layout and measurements','Photograph marked boundaries and tape or laser readings. Record measured dimensions in Notes.','existing_condition'],
      ['access','Access for crew and equipment','Show gates, narrow passages, delivery access, and obstacles.','existing_condition'],
      ['drainage','Slope and drainage','Show slopes, low spots, downspouts, and where water collects or flows.','existing_condition'],
      ['removal','Removal and site preparation needed','Show concrete, soil, plants, or other material that may need to be removed.','existing_condition'],
      ['customer_request','Customer requests and scope','Photograph the area while recording what the customer wants included or left alone.','existing_condition'],
      ['finish_reference','Finish or design reference','Capture a sample, color, texture, or nearby example the customer likes.','existing_condition']
    ]},
    {id:'work',label:'While doing the work',hint:'Document progress, details that will be covered, and changes as the work happens.',purposes:[
      ['demolition','Demolition and excavation','Show removal progress, excavation, and any newly exposed conditions.','pre_pour'],
      ['base','Base preparation','Show the prepared base and any measured depth before it is covered.','pre_pour'],
      ['formwork','Forms and layout','Show form positions, edges, slopes, and layout measurements.','formwork'],
      ['reinforcement','Reinforcement and embedded items','Photograph reinforcement and embedded items before the pour covers them.','reinforcement'],
      ['pre_pour','Before the pour','Capture the full prepared area and details you want on record before placement.','pre_pour'],
      ['delivery','Concrete delivery and batch ticket','Photograph the delivery or ticket. Attach a ticket to its placement photo later if needed.','placement'],
      ['placement','Concrete placement','Show the pour and progress across the work area.','placement'],
      ['finishing','Finishing and joints','Photograph the surface finish, edges, and joints as they are made.','finishing'],
      ['curing','Curing and protection','Show how the fresh concrete and surrounding area are being protected.','curing'],
      ['scope_change','Change or extra work','Photograph what changed and record the requested work and who discussed it.','placement'],
      ['work_problem','Problem during the work','Record the location, visible condition, and what happened during this project.','defect']
    ]},
    {id:'completion',label:'When the work is finished',hint:'Show the finished result, completed scope, and details for the customer handoff.',purposes:[
      ['finished_overview','Finished project overview','Show the completed patio, driveway, sidewalk, or other work from useful viewpoints.','completed'],
      ['finished_details','Finish, edges, and joints','Capture close views of the completed surface and details.','completed'],
      ['completed_dimensions','Completed layout and measurements','Photograph the final boundaries and any measured dimensions.','completed'],
      ['water_check','Drainage check','Record the conditions and observations during a drainage check, if one is performed.','verification'],
      ['cleanup','Cleanup and surrounding property','Show cleanup, restored areas, and the condition of nearby property.','completed'],
      ['handoff','Customer walkthrough or punch list','Photograph walkthrough items and record what was discussed or still needs attention.','completed'],
      ['completion_comparison','After photo for comparison','Match the viewpoint of a before photo so the completed work can be compared.','completed']
    ]},
    {id:'follow_up',label:'Later visit or follow-up',hint:'Revisit the project, document a reported concern, or follow a repair through completion.',purposes:[
      ['routine_review','Scheduled revisit or condition check','Record how the work looks after time has passed and why you are revisiting.','existing_condition'],
      ['reported_problem','Reported problem or concern','Show the reported condition, its location, and when it was noticed.','defect'],
      ['monitoring','Monitor a change over time','Use the same viewpoint and include a scale where useful for later comparison.','existing_condition'],
      ['repair','Repair work','Photograph the condition being repaired and the repair progress.','repair'],
      ['repair_check','After repair or final check','Show the repaired area and record what was checked.','verification']
    ]}
  ];
  const elements={patio:'Patio',driveway:'Driveway',sidewalk:'Sidewalk / walkway',slab:'Slab',foundation:'Foundation',steps:'Steps',curb:'Curb',wall:'Wall',column:'Column',beam:'Beam',deck:'Deck',other:'Other'};
  function phase(id){return phases.find(p=>p.id===id);}
  function purpose(phaseId,id){return phase(phaseId)?.purposes.find(p=>p[0]===id);}
  function normalize(value){
    const p=phase(value.concrete_phase),why=purpose(p?.id,value.concrete_purpose);
    return {concrete_phase:p?.id||null,concrete_purpose:why?.[0]||null,concrete_stage:why?.[3]||null};
  }
  function summary(c,translate=x=>x){const p=phase(c.concrete_phase),why=purpose(c.concrete_phase,c.concrete_purpose);return [p?.label,why?.[1]].filter(Boolean).map(translate).join(' / ');}
  return {phases,elements,phase,purpose,normalize,summary};
});

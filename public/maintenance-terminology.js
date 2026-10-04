/* Shared presentation vocabulary. Stored HOA identifiers and customer evidence stay unchanged. */
(function(root){
'use strict';
const replacements=[
 ['HOA Maintenance Pro or Property Manager Pro user not found','Eligible management-team user not found'],
 ['HOA uses property-specific workspaces','Property Manager uses property-specific workspaces'],
 ['Property Manager or HOA Organize','Property Manager Organize'],
 ['HOA / Community','Property'],['Select an HOA or community','Select a property'],
 ['Communities organize asset photos and inspection routes. This is not a general HOA directory.','Properties organize asset photos and inspection routes. Each property keeps its own photo evidence and records.'],
 ['Manage the HOAs and neighborhoods served by','Manage the properties served by'],
 ['Board Photo Maintenance Report','Property Maintenance Report'],['Board Photo Report','Property Maintenance Report'],['Board photo report','Property maintenance report'],
 ['Board Decision Needed','Approval Needed'],['Waiting for Board','Waiting for Approval'],['Board Needed','Approval Needed'],
 ['Board Determination Needed','Approval Needed'],['Board Approval','Approval'],['Board approval','Approval'],
 ['On Meeting Agenda','Approval Requested'],['Operating Budget','Operating / Maintenance'],['Reserve Budget','Capital'],
 ['board-ready','property maintenance'],['board reports','property maintenance reports'],['board-approval','approval'],
 ['customer/board decision','customer or management approval decision'],['Choose or filter the budget source, such as operating funds or reserves, using the available choices. Review funding before approving or reporting work.','Choose or filter Operating / Maintenance, Capital, Approval Needed, or Unassigned. These are maintenance classifications, not an accounting ledger. Review funding before approving or reporting work.'],['Update this only when you have evidence of the decision.','Update this only when you have evidence of the decision. Approval Requested includes legacy meeting-agenda records and does not send an approval request.'],
 ['community/property','property'],['property/community','property'],['selected community/project','selected property/project'],
 ['Community','Property'],['Communities','Properties'],['community','property'],['communities','properties'],
 ['In HOA Maintenance Pro and Property Manager Pro','In Property Manager Pro']
];
function text(value,edition){if(edition!=='property')return String(value??'');let result=String(value??'');for(const [from,to] of replacements)result=result.split(from).join(to);if(result==='Operating')return 'Operating / Maintenance';if(result==='Reserve')return 'Capital';return result;}
function budget(value,edition){const labels={operating:'Operating Budget',reserve:'Reserve Budget',board_determination:'Board Determination Needed',unassigned:'Unassigned'};return text(labels[value]||value||'Unassigned',edition);}
function status(value,edition){const labels={board_decision:'Board Decision Needed',waiting_board:'Waiting for Board'};return text(labels[value]||String(value||'').replaceAll('_',' '),edition);}
function approval(value,edition){const labels={not_required:'Not Required',requested:'Approval Requested',agenda:'On Meeting Agenda',approved:'Approved',rejected:'Rejected',deferred:'Deferred',more_information:'More Information Requested'};return text(labels[value]||value||'Not Required',edition);}
function field(value,edition){if(edition!=='property')return value;return ({board_approval:'Approval',budget_source:'Budget Source',community_id:'Property',status:'Status',primary_assignee:'Primary Assignee',target_date:'Target Completion Date',completed_by:'Vendor or Completed By',completion_date:'Completion Date',estimated_cost:'Estimated Cost',actual_cost:'Actual Cost',directed_to:'Directed To',item_type:'Record Type',photo_stage:'Photo Stage'})[value]||String(value).replaceAll('_',' ');}
const api={text,budget,status,approval,field};if(typeof module==='object'&&module.exports)module.exports=api;else root.PhotoNotesMaintenanceTerminology=api;
})(typeof window==='object'?window:globalThis);

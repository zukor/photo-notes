'use strict';
// Property Manager Pro review fixes: commercial categories, navigation, readable history and labels.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const vocabulary=require('../public/maintenance-terminology');
const app=fs.readFileSync('public/app.js','utf8'),server=fs.readFileSync('server.js','utf8');
const line=start=>{const i=app.indexOf(start);assert(i>=0,start);return app.slice(i,app.indexOf('\n',i));};
const block=(start,end)=>{const i=app.indexOf(start),j=app.indexOf(end,i);assert(i>=0&&j>i,start);return app.slice(i,j);};
function context(proType){const c={state:{proType},PhotoNotesMaintenanceTerminology:vocabulary,esc:v=>String(v??'')};vm.createContext(c);
 vm.runInContext([line('const PROPERTY_CATEGORIES='),line('function hoaCategories('),line('const HOA_AREAS='),block('function hoaHistoryLabel(','\nfunction hoaAssigneeControl('),line('function hoaText('),line('function hoaManagementLabel(')].join('\n')+'\nthis.api={PROPERTY_CATEGORIES,HOA_AREAS,hoaCategories,hoaHistoryLabel,hoaManagementLabel};',c);return c.api;}

test('Property Manager Pro uses commercial categories and keeps saved category text selectable',()=>{
 const p=context('property'),h=context('hoa');
 assert(p.hoaCategories().includes('HVAC'));assert(p.hoaCategories().includes('Fire and Life Safety'));assert(!p.hoaCategories().includes('Pools and Recreation'));assert(!p.hoaCategories().includes('Mailboxes'));
 assert.equal(p.hoaCategories().at(-1),'Other');assert.equal(JSON.stringify(p.hoaCategories('Pools and Recreation').slice(-2)),JSON.stringify(['Other','Pools and Recreation']));
 assert.equal(h.hoaCategories(),h.HOA_AREAS);assert(h.hoaCategories().includes('Pools and Recreation'));assert.equal(h.hoaCategories('Maintenance').at(-1),'Maintenance');
 assert.equal(p.hoaCategories('HVAC').filter(x=>x==='HVAC').length,1);
 assert.match(app,/<select id="hoaArea">\$\{hoaCategories\(\)/);assert.match(app,/<select id="hiArea">\$\{hoaCategories\(i\.area\)/);
});

test('management screens are reachable with edition labels',()=>{
 const p=context('property'),h=context('hoa');
 assert.equal(p.hoaManagementLabel('communities'),'Properties and Team');assert.equal(p.hoaManagementLabel('dashboard'),'Dashboard');assert.equal(p.hoaManagementLabel('reports'),'Maintenance Report');
 assert.equal(h.hoaManagementLabel('communities'),'Communities and Team');assert.equal(h.hoaManagementLabel('reports'),'Maintenance Reports');
 for(const id of ['menuHoaCommunities','menuHoaDashboard','menuHoaReports','hoaOpenCommunities','hoaOpenDashboard','hoaOpenReports'])assert(app.includes(`id="${id}"`),id);
 for(const view of ['hoa-communities','hoa-dashboard','hoa-reports'])assert(app.includes(`'${view}']]`)||app.includes(`'${view}'],[`),view);
 assert(app.includes('data-edit-community=')&&app.includes('data-save-community=')&&app.includes("api('/api/hoa/communities/'+id"));
});

test('activity history names every recorded maintenance action',()=>{
 const p=context('property'),h=context('hoa');
 const actions=[...server.matchAll(/hoaHistory\([^,]+,[^,]+,'([a-z_]+)'/g)].map(m=>m[1]).concat([...fs.readFileSync('photo-requests.js','utf8').matchAll(/hoaHistory\([^,]+,[^,]+,'([a-z_]+)'/g)].map(m=>m[1]));
 for(const action of new Set(actions)){const label=p.hoaHistoryLabel({action,detail:{}});assert(label&&!label.includes('_'),action);if(action!=='updated')assert.notEqual(label,'Updated',action);}
 assert.equal(p.hoaHistoryLabel({action:'status_changed',detail:{from:'new',to:'board_decision'}}),'Status Changed: New to Approval Needed');
 assert.equal(h.hoaHistoryLabel({action:'status_changed',detail:{from:'new',to:'board_decision'}}),'Status Changed: New to Board Decision Needed');
 assert.equal(p.hoaHistoryLabel({action:'photo_added',detail:{photo_stage:'completed_work'}}),'Photo Added: Completed Work');
 assert.equal(p.hoaHistoryLabel({action:'completion_photo_requested',detail:{recipient_name:'ACME Roofing'}}),'Completion Photos Requested from ACME Roofing');
 assert.equal(p.hoaHistoryLabel({action:'completion_photos_submitted',detail:{photo_count:3}}),'Completion Photos Received (3)');
 assert.equal(p.hoaHistoryLabel({action:'assigned',detail:{assignee:'Fixture Mate'}}),'Assigned to Fixture Mate');
});

test('shared labels read in plain words for both editions',()=>{
 assert.equal(vocabulary.status('work_in_progress','hoa'),'Work In Progress');assert.equal(vocabulary.status('waiting_board','property'),'Waiting for Approval');
 assert.equal(vocabulary.field('primary_assignee','hoa'),'Primary Assignee');assert.equal(vocabulary.field('board_approval','hoa'),'Board Approval');assert.equal(vocabulary.field('board_approval','property'),'Approval');assert.equal(vocabulary.field('community_id','property'),'Property');assert.equal(vocabulary.field('area','property'),'Category');
});

test('Capture can document a photo against a Property without opening a record',()=>{
 assert(app.includes('id="hoaCreateRecord"'));assert(app.includes("payload.hoa_create_record=document.getElementById('hoaCreateRecord').checked?'1':'0'"));assert(app.includes("fd.append('hoa_create_record',p.hoa_create_record)"));
 assert(server.includes("const documentOnly=captureProduct==='property'&&"));assert(server.includes('if(!documentOnly&&'));
});

test('server wording and validation follow the edition',()=>{
 assert(!server.includes("'HOA Maintenance Pro or Property Manager Pro required'"));assert(!fs.readFileSync('photo-follow-ups.js','utf8').includes('Property Manager or HOA Pro team member'));
 assert(fs.readFileSync('property-areas.js','utf8').includes("error:'Invalid Property'"));
 assert(!/item\.photos=\(await pool\.query/.test(server),'report photos are batched');assert(server.includes('hp.item_id=ANY($1::integer[])'));
});

test('UI text added for Property Manager Pro avoids restricted words and em dashes',()=>{
 const added=['Properties and Team','Maintenance Report','Create Maintenance Record','Outside Vendor or Other Person','Property Manager or Contact','Assigned to you: '];
 for(const text of added){assert(app.includes(text)||server.includes(text),text);assert(!/owner|owns|ownership|—/i.test(text));}
});

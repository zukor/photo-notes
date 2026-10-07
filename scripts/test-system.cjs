'use strict';
// One gate, deterministic providers, isolated feature databases, bounded child processes.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {Pool} = require('pg');
const root = path.resolve(__dirname, '..');
const mode = process.argv[2] || 'fast';
if (!['fast','full'].includes(mode)) throw Error('Usage: node scripts/test-system.cjs fast|full');
const runLabel=process.argv[3]||mode;if(!/^[a-z0-9-]+$/.test(runLabel))throw Error('Invalid run label');
const output = path.join(root, 'output', 'automated-testing', runLabel);
fs.mkdirSync(output, {recursive:true});
const env = {...process.env};
for (const key of Object.keys(env)) if (/DATABASE_URL|API_KEY|TOKEN|SECRET|ADMIN_PASSWORD|SUPER_ADMIN_USER_IDS|^PN_.*TEST|^PN_.*RETEST|^PN_DOCUMENT_LINKS|^PN_UI_REVIEW/.test(key)) delete env[key];
Object.assign(env, {SESSION_SECRET:'automated-test-local-only',ISSUE_CLOUD_RUNNER_ENABLED:'false',PGSSL:'',LC_ALL:'C',LANG:'C'});
const focus=process.argv[4]?process.argv[4].split(','):null;
function sourceFingerprint(){const {execFileSync}=require('node:child_process');const crypto=require('node:crypto');const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root}).toString().split('\0').filter(file=>file&&!file.startsWith('output/')&&!file.startsWith('tmp/')&&!file.startsWith('work/')&&/\.(js|cjs|css|html|sql|json|svg)$/.test(file)).sort();const hash=crypto.createHash('sha256');for(const file of [...new Set(files)])if(fs.existsSync(path.join(root,file)))hash.update(file+'\0').update(fs.readFileSync(path.join(root,file)));return hash.digest('hex');}
const startingFingerprint=sourceFingerprint();
if(!focus&&process.env.PN_BROWSER_DEVICE)throw Error('A device filter is permitted only for focused diagnostics.');
const visualRequired=Boolean(process.env.PN_VISUAL_BASELINES);
const results = [];
async function run(feature, args, overrides = {}, timeout = 180000) {
 const started = Date.now(), log = path.join(output, feature+'.log');
 const stream = fs.createWriteStream(log);
 console.log('RUN '+feature);
 const result = await new Promise(resolve => {
  const child = spawn(process.execPath, ['--require',path.join(root,'test/support/no-external-network.cjs'),...args], {cwd:root,env:{...env,...overrides},stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
  child.stdout.pipe(stream,{end:false}); child.stderr.pipe(stream,{end:false});
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}},timeout);
  child.on('error',error=>{stream.write(error.message);});
  child.on('close',(code,signal)=>{clearTimeout(timer);stream.end(()=>resolve({feature,status:code===0&&!timedOut?'passed':'failed',code,signal,timedOut,durationMs:Date.now()-started,log:path.relative(root,log)}));});
 });
 results.push(result); console.log(result.status.toUpperCase()+' '+feature+' ('+Math.round(result.durationMs/1000)+'s)');
 if(result.status==='failed')console.log(fs.readFileSync(log,'utf8').slice(-3500));
 return result;
}
const browserSuites = [
 'automation-edition-browser','proposal-exhibit',
 'complete-help','admin-help','all-edition-help','shared-workflow-parity','location-intelligence',
 'shared-camera-readers','capture-voice','issue-completion-browser','issue-result-screenshot','sticky-workflow-menu','batch-annotations-browser','custom-annotation-templates','document-title','document-photo-source','crop-context-browser','testing-dashboard','record-notes-check','capture-templates','property-incidents',
 'property-incident-report','property-terminology','photo-markers','send-shortcuts','send-photo-selection','send-photo-filters','review-share-organize','capture-job-library',
 'visual-analysis-browser','photo-requests-browser','qr-codes-browser','related-photos-browser',
 'photo-comments-browser','photo-comments-app','bulk-metadata-browser','custom-fields-browser',
 'saved-views-browser','saved-views-help','property-global-parity','shared-before-after-browser'
];
const legacySuites = [
 ['batch-annotations.integration','PN_LEGACY_TEST_DATABASE_URL','pn_annotations_test','PN_ANNOTATION_TEST'],
 ['document-links.integration','PN_LEGACY_TEST_DATABASE_URL','pn_document_links_test','PN_DOCUMENT_LINKS'],
 ['photo-evidence-export.integration','PN_LEGACY_TEST_DATABASE_URL','pn_evidence_test','PN_EVIDENCE_EXPORT_TEST'],
 ['unresolved-bugs.integration','PN_LEGACY_TEST_DATABASE_URL','pn_bugs_test','PN_BUG_RETEST'],
 ['ui-improvement-review.integration','PN_LEGACY_TEST_DATABASE_URL','pn_review_test','PN_UI_REVIEW_TEST'],
 ['scanner-service.integration','PN_LEGACY_TEST_DATABASE_URL','pn_scanner_test','PN_SCANNER_RETEST'],
 ['pro-retest.integration','PN_LEGACY_TEST_DATABASE_URL','pn_pro_test','PN_PRO_RETEST'],
 ['issue-reminders.integration','PN_LEGACY_TEST_DATABASE_URL','pn_reminders_test','PN_REMINDER_TEST'],
 ['issue-auto-retest.integration','PN_LEGACY_TEST_DATABASE_URL','pn_auto_test','PN_AUTO_RETEST_TEST'],
 ['web-capture-integration','PN_WEB_TEST_DATABASE_URL','pn_ios_test'],
 ['ramo-intake-integration','PN_RAMO_TEST_DATABASE_URL','pn_ramo_test'],
 ['issue-cloud','PN_CLOUD_TEST_DB','pn_cloud_test'],
 ['issue-category-queue','PN_CATEGORY_TEST_DB','pn_category_test'],
 ['testing-hub-integration','PN_TESTING_HUB_DB','pn_testing_hub'],
 ['issue-form','ISSUE_FORM_DATABASE_URL','pn_issue_form_test'],
 ['tester-hub','TESTER_HUB_DATABASE_URL','pn_tester_hub_test'],
 ['user-deletion','USER_DELETION_TEST_DATABASE_URL','pn_deletion_test'],
 ['issue-followup.integration','PN_LEGACY_TEST_DATABASE_URL','pn_issue_followup_test','PN_ISSUE_FLOW_TEST'],
 ['issue-backlog-repairs.integration','PN_LEGACY_TEST_DATABASE_URL','pn_issue_backlog_test','PN_ISSUE_FLOW_TEST']
];
const databaseSuites = [
 ['automation-core-db','PN_ISOLATED_DATABASE_URL','pn_core_test'],
 ['automation-offline-browser','PN_WEB_TEST_DATABASE_URL','pn_ios_test'],
 ['photo-requests-integration','PN_REQUEST_TEST_DATABASE_URL','pn_requests_test'],
 ['qr-codes-integration','PN_QR_TEST_DATABASE_URL','pn_qr_test'],
 ['related-photos-integration','RELATED_PHOTOS_TEST_DATABASE_URL','pn_related_test'],
 ['visual-analysis-integration','VISUAL_ANALYSIS_TEST_DATABASE_URL','pn_visual_analysis_test'],
 ['custom-fields-integration','CUSTOM_FIELDS_TEST_DATABASE_URL','pn_custom_fields_test'],
 ['saved-views-integration','SAVED_VIEWS_TEST_DATABASE_URL','pn_saved_views_test'],
 ['saved-views-app','SAVED_VIEWS_APP_TEST_DATABASE_URL','pn_saved_views_app_test'],
 ['bulk-metadata-db','BULK_TEST_DATABASE_URL','pn_bulk_test'],
 ['photo-comments-integration','PN_ISOLATED_DATABASE_URL','pn_comments_test'],
 ['property-incidents-db','PN_ISOLATED_DATABASE_URL','pn_incidents_test'],
 ['property-areas','PN_ISOLATED_DATABASE_URL','pn_areas_test'],
 ['property-visit-area-integration','PN_ISOLATED_DATABASE_URL','pn_area_visit_test'],
 ['property-incident-deletion','PN_ISOLATED_DATABASE_URL','pn_incident_deletion_test'],
 ['property-area-capture-integration','DATABASE_URL','pn_property_area_capture_test'],
 ['property-incident-capture-integration','DATABASE_URL','pn_property_incident_capture_test'],
 ['photo-follow-ups-integration','DATABASE_URL','pn_followup_integration'],
 ['export-presets','DATABASE_URL','pn_export_presets_test'],
 ['export-presets-private-comments','DATABASE_URL','pn_export_presets_output_test'],
 ['shared-before-after-integration','DATABASE_URL','pn_shared_pairs_test']
];
if(focus){const known=new Set([...databaseSuites,...legacySuites].map(row=>row[0]).concat(browserSuites));for(const feature of focus)if(!known.has(feature))throw Error('Unknown focused suite: '+feature);}
(async()=>{
 let admin, temporaryCluster;
 try {
  if(!focus)await run('help-source-guidance',['scripts/help-coverage.cjs']);
  const files=fs.readdirSync(path.join(root,'test')).filter(f=>f.endsWith('.test.js')).sort();
  if(!focus)await run('unit-and-regression',['--test','--test-concurrency=4','--test-timeout=60000',...files.map(f=>'test/'+f)],{},300000);
  if(mode==='full') {
   // A supplied URL must name a disposable local database. Never inherit DATABASE_URL.
   let connection=process.env.PN_AUTOMATION_DATABASE_URL;
   if(!connection){
    temporaryCluster=fs.mkdtempSync(path.join(os.tmpdir(),'pnqa-'));
    const {execFileSync}=require('node:child_process');
    execFileSync('initdb',['-D',temporaryCluster,'-A','trust','-U','pn_test','--encoding=UTF8'],{stdio:'pipe',env});
    // Private Unix socket avoids collisions with existing developer PostgreSQL servers.
    execFileSync('pg_ctl',['-D',temporaryCluster,'-l',path.join(temporaryCluster,'postgres.log'),'-o',`-k ${temporaryCluster} -h ''`,'-w','start'],{stdio:'pipe',env});
    connection=`postgresql://pn_test@localhost/postgres?host=${encodeURIComponent(temporaryCluster)}`;
   }
   const url=new URL(connection);
   if(!['localhost','127.0.0.1'].includes(url.hostname)||!['/postgres','/pn_automation_test'].includes(url.pathname))throw Error('PN_AUTOMATION_DATABASE_URL must use localhost and postgres or pn_automation_test.');
   admin=new Pool({connectionString:connection}); await admin.query('SELECT 1');
   for(const [feature,key,name,flag] of [...databaseSuites,...legacySuites]){
    if(focus&&!focus.includes(feature))continue;
    const existing=await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name]);
    if(existing.rowCount)throw Error('Refusing to overwrite existing database '+name+'. Use the automatically created cluster.');
    await admin.query('CREATE DATABASE '+name);
    const scoped=new URL(connection);scoped.pathname='/'+name;scoped.hostname='127.0.0.1';
    const legacy=legacySuites.some(row=>row[0]===feature);
    await run(feature,legacy?['--test','test/'+feature+'.test.js']:['scripts/test-'+feature+'.cjs'],{[key]:scoped.toString(),...(flag?{[flag]:'1'}:{}),PN_AUTOMATION_DATA_DIR:temporaryCluster||url.searchParams.get('host')||'',PN_WEB_TEST_DATA_DIR:temporaryCluster||url.searchParams.get('host')||'',UPLOAD_DIR:path.join(temporaryCluster||url.searchParams.get('host')||'',name+'-uploads')},legacy?180000:180000);
    await admin.query('DROP DATABASE '+name+' WITH (FORCE)');
   }
   for(const feature of browserSuites.filter(feature=>!focus||focus.includes(feature)))await run(feature,['scripts/test-'+feature+'.cjs'],{},feature==='complete-help'?360000:180000);
   if(!focus&&visualRequired)await run('visual-baselines',['scripts/compare-visual-baselines.cjs']);
  }
 } catch(error) {results.push({feature:'environment',status:'failed',error:error.message});console.error(error.message);}
 finally {
  if(admin)await admin.end();
  if(temporaryCluster){try{require('node:child_process').execFileSync('pg_ctl',['-D',temporaryCluster,'-m','immediate','-w','stop'],{stdio:'pipe'});}catch{}fs.rmSync(temporaryCluster,{recursive:true,force:true});}
  const regressionLog=path.join(output,'unit-and-regression.log');
  const skipped=fs.existsSync(regressionLog)?Number((fs.readFileSync(regressionLog,'utf8').match(/(?:ℹ|#) skipped (\d+)/)||[])[1]||0):0;
  const legacyPassed=results.filter(r=>legacySuites.some(row=>row[0]===r.feature)&&r.status==='passed').length;
  const uncovered=Math.max(0,skipped-legacyPassed);
  const warnings=uncovered?[`${uncovered} environment-gated legacy integration tests did not run. This gate does not yet replace them.`]:[];
  warnings.push(visualRequired?'Field-photo AI evaluation remains separate from automated checks.':'Screenshots are review artifacts; approved image comparison baselines and field-photo AI evaluation are pending.');
  const endingFingerprint=sourceFingerprint();const sourceChanged=endingFingerprint!==startingFingerprint;if(sourceChanged)warnings.push('Source changed while the gate ran. Rerun on the immutable integration candidate.');
  const report={mode,focus,startingFingerprint,endingFingerprint,sourceChanged,skippedLegacyTests:skipped,warnings,generatedAt:new Date().toISOString(),results,readyForHumanTesting:mode==='full'&&!focus&&!sourceChanged&&uncovered===0&&results.length===2+databaseSuites.length+legacySuites.length+browserSuites.length+(visualRequired?1:0)&&results.every(r=>r.status==='passed')};
  fs.writeFileSync(path.join(output,'status.json'),JSON.stringify(report,null,2)+'\n');
  fs.writeFileSync(path.join(output,'human-testing.md'),`# Human testing handoff\n\nAutomated gate: ${report.readyForHumanTesting?'passed':'not release-ready'}. See status.json and feature logs.\n\n- Physical iPhone and Android: camera, microphone final transcript, GPS accuracy, share sheet, PWA installation, offline restart.\n- Field usability: readability, controls, speed, locating the photographed asset and completing requested photos.\n- AI quality: real equipment plates, gauges, concrete and pavement under field lighting.\n- Visual review: report photo placement, print readability and specialty terminology.\n\nOnly test affected workflows for this release. Browser simulations do not establish physical-device acceptance.\n`);
  process.exitCode=results.some(r=>r.status==='failed')||(mode==='full'&&!focus&&!report.readyForHumanTesting)?1:0;
 }
})();

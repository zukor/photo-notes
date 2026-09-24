(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.PhotoNotesRetestGuidance=factory();
})(typeof window!=='undefined'?window:globalThis,function(){
  const versions={basic:'Photo Notes Basic',pro:'Photo Notes Pro',paving:'Paving Pro',concrete:'Concrete Pro',contractor:'General Contractor Pro',hoa:'HOA Maintenance Pro',roofer:'Roofer Pro',roads:'Road Issue Reporter'};
  function checksFor(issue={}){
    // Use report context to select user-side checks. Never forward private run
    // logs, credentials, or speculative repair diagnoses into the message.
    const report=[issue.description,issue.reporter_details,issue.page_name].filter(Boolean).join(' ').toLowerCase();
    const review=String(issue.blocked_reason||'').toLowerCase().split(/[.\n]+/).filter(line=>!/github|cloud run|credential|api key|workflow|worker|deployment|maintainer|commit/.test(line)).join(' ');
    const context=report+' '+review;
    const checks=[];
    if(/annotat|markup|text box|arrow|anotaci|marcado/.test(context))checks.push('Add a text annotation as well as an arrow or box. Save, leave Edit, and reopen the same photo. Check that the text and shapes are all still visible.');
    if(/crop|recort/.test(context))checks.push('Crop a test photo, save it, then leave and reopen the photo. Check that the saved crop matches the preview.');
    if(/screenshot|report issue|captura de pantalla/.test(context))checks.push('Open Report Issue on the affected page and check the screenshot, including the top of the page. Close it without sending a duplicate report, then reopen it five times and note which attempt fails.');
    if(/template|plantilla/.test(context))checks.push('Use the same Word template that caused the issue. Import it, select it when creating a new document, and check whether the generated document uses it.');
    if(/export|pdf|word|zip|document|documento/.test(context))checks.push('Generate a fresh file from the same photos and open the exported file. Compare the photo order, notes, dates, topics, and locations with the app preview. Record which file format and details differ.');
    if(/shar|teams|send.{0,30}(file|word|zip|pdf|document)|compart|enviar.{0,30}(archivo|documento)/.test(context))checks.push('Repeat the same sending or sharing method using a test file and a test recipient or your own account. Check whether the file opens at the destination, and record the browser, file type, and any error message.');
    if(/search|clear button|button.{0,10}clear|filter|búsqu|buscar|filtro/.test(context))checks.push('Repeat the same search or filter, then use Clear if that was part of the reported problem. Check whether the expected full list returns.');
    if(/scan|escane/.test(context))checks.push('Use a clear, well-lit photo of the same kind of item and repeat the scan. Note whether the problem occurs while capturing the image, processing it, or displaying the result.');
    if(/microphone|record notes|speech|dictat|micrófono|dictado/.test(context))checks.push('If this uses voice input, check that the browser allows microphone access. Record a short test and check whether the words appear.');
    if(/camera.*permission|permission.*camera|camera access|permiso.*cámara/.test(context))checks.push('Check that this browser is allowed to use the camera, then try taking a test photo.');
    if(/offline|internet|connection|network|conexión|sin conexión/.test(context))checks.push('Check whether the device is online. Repeat once with a stable connection and note whether the issue only happens offline.');
    if(/broken.{0,15}image|photo.{0,25}(missing|not load)|image.{0,25}not load/.test(context))checks.push('Save a new test photo, open Organize, and check its thumbnail and full-size view. Note whether it appears immediately or only after refreshing.');
    if(/gps|location|geolocation|ubicaci/.test(context))checks.push('Check that location is allowed both on the device and for this website in the browser. Use Retry for a fresh reading and compare the displayed location with the actual place. Report how far off it is.');
    if(/slow|delay|minute|performance/.test(context))checks.push('Repeat with the same photo library. Time how long it takes from saving to seeing the result, and record the approximate number of photos in the library.');
    if(/classif|pavement|pavimento/.test(context))checks.push('Use the original photos that failed. Record the result for each photo, including any error, instead of checking only whether a different photo works.');
    if(/gauge|fahrenheit|celsius|dual.dial/.test(context))checks.push('Use the original gauge photo. Compare each displayed reading and its unit with the corresponding dial in the photo.');
    if(/blur|unreadable|ticket.*field/.test(context))checks.push('Compare each extracted field with the source photo. Identify any value that the app supplied even though it cannot be read in the photo.');
    if(/plate.*(second|reading|scan)|second.*plate/.test(context))checks.push('Keep the original plate photo and compare both scan results with it. Identify the exact field that differs and which value is visible in the photo.');
    if(/older.*(overlay|alignment|comparison)|alignment.*saved again/.test(context))checks.push('For an older comparison, set and save its alignment again, then reopen and export it. Compare the saved view with the export.');
    if(/satellite|map provider|map.*zoom|imagery/.test(context))checks.push('Open the same property and zoom level. Note whether the map is blank or merely lacks detail, and record the location and zoom level.');
    return checks;
  }
  function build(issue={}){
    const checks=checksFor(issue);
    const version=versions[issue.reported_edition];
    const steps=[
      'Save any unfinished work, then refresh Photo Notes. Use the same device and browser as the original report.',
      (version?'Select '+version+'. ':'')+'Repeat the steps in your original report using the same kind of photo or document.'
    ];
    steps.push(...checks);
    steps.push('Choose No Longer Happening or Still Happening below. If it still happens, add the exact steps, what you see, and any error message in the retest note.');
    return 'Please test this again and see if it is still happening. No fix is being claimed.\n\nRecommended checks:\n'+steps.map((step,index)=>(index+1)+'. '+step).join('\n\n');
  }
  return {build,checksFor};
});

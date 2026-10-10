// Photo Notes add-on (loaded after app.js):
//  1. Basic shares directly. Other editions save the capture before sharing.
//     Desktop browsers without Web Share use email and a photo download.
//  2. Moves the Zukor AI corner logo to the far left and shrinks it.
// Shipped as a separate file so it can deploy without rebuilding app.js.
(function () {
  var lastFile = null; // most recently picked photo (survives topic re-renders)

  // Capture the chosen photo whenever a file input changes.
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t && (t.id === 'photoCam' || t.id === 'photoLib') && t.files && t.files[0]) lastFile = t.files[0];
  }, true);
  // After the app's own Save runs, the form resets — drop the cached photo.
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'save') setTimeout(function () { lastFile = null; }, 0);
  }, true);

  function q(id) { return document.getElementById(id); }
  function tr(text) { return window.photoNotesI18n ? window.photoNotesI18n.t(text) : text; }
  function locale() { return window.photoNotesI18n && window.photoNotesI18n.getLanguage() === 'es' ? 'es-US' : undefined; }
  function noteVal() { return q('note') ? q('note').value.trim() : ''; }

  var stateAbbr = { Alabama:'AL', Alaska:'AK', Arizona:'AZ', Arkansas:'AR', California:'CA', Colorado:'CO', Connecticut:'CT', Delaware:'DE', Florida:'FL', Georgia:'GA', Hawaii:'HI', Idaho:'ID', Illinois:'IL', Indiana:'IN', Iowa:'IA', Kansas:'KS', Kentucky:'KY', Louisiana:'LA', Maine:'ME', Maryland:'MD', Massachusetts:'MA', Michigan:'MI', Minnesota:'MN', Mississippi:'MS', Missouri:'MO', Montana:'MT', Nebraska:'NE', Nevada:'NV', 'New Hampshire':'NH', 'New Jersey':'NJ', 'New Mexico':'NM', 'New York':'NY', 'North Carolina':'NC', 'North Dakota':'ND', Ohio:'OH', Oklahoma:'OK', Oregon:'OR', Pennsylvania:'PA', 'Rhode Island':'RI', 'South Carolina':'SC', 'South Dakota':'SD', Tennessee:'TN', Texas:'TX', Utah:'UT', Vermont:'VT', Virginia:'VA', Washington:'WA', 'West Virginia':'WV', Wisconsin:'WI', Wyoming:'WY', 'District of Columbia':'DC' };
  function shortState(address) {
    var value = String(address || '').trim();
    Object.keys(stateAbbr).forEach(function (name) { value = value.replace(new RegExp('\\b' + name + '\\b', 'g'), stateAbbr[name]); });
    return value;
  }

  function caption() {
    var parts=[],current=typeof state!=='undefined'?state:{};
    function add(label,value){if(value!==undefined&&value!==null&&String(value).trim())parts.push(tr(label)+': '+String(value).trim());}
    var location=current.location;
    var gps=location&&Number.isFinite(location.lat)&&Number.isFinite(location.lng)?location.lat+', '+location.lng:(q('gps')?.textContent||'').trim();
    if(/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(gps))add('GPS Coordinates',gps);
    var address=current.address||(q('addr')?.textContent||'').trim();
    if(address&&!/\.\.\.|^(waiting|getting|looking up|address lookup|address not found|exact address not found|no address|tap retry|you can still)/i.test(address))add('Address',address);
    add('Notes',noteVal());
    add('Topic',current.area);
    add('Saved Capture Settings',current._captureTemplateName);
    if(current.jobId){var job=(current.jobs||[]).find(function(row){return String(row.id)===String(current.jobId);});add('Job',job?.name||current.jobId);}
    // Include the PhotoNote fields, including specialist and custom details,
    // without including photo pickers or template-management configuration.
    var fields=typeof document!=='undefined'?document.querySelectorAll('#body input,#body select,#body textarea'):[];
    Array.from(fields).forEach(function(el){
      if(['note','newarea','photoCam','photoLib'].includes(el.id)||['file','password','button','submit','hidden'].includes(el.type)||/^ct/.test(el.id))return;
      if(['checkbox','radio'].includes(el.type)&&!el.checked)return;
      if(el.tagName==='SELECT'&&!el.value)return;
      var value=el.tagName==='SELECT'?(el.selectedOptions?.[0]?.textContent||el.value):el.value;
      if(!value)return;
      var previous=el.previousElementSibling;
      var label=el.labels?.[0]?.textContent||el.getAttribute('aria-label')||(previous?.tagName==='LABEL'?previous.textContent:'');
      if(label)add(label,value);
    });
    add('Shared at',new Date().toLocaleString(locale()));
    return parts.join('\n');
  }

  function toast(m) {
    if(typeof window.toast==='function'){window.toast(tr(m));return;}
    var t = q('toast');
    if (t) { t.textContent = tr(m); t.style.display = 'block'; setTimeout(function () { t.style.display = 'none'; }, 2200); }
  }

  async function share(file, text) {
    share.lastOutcome='prepared';
    try {
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: text, title: tr('Photo Note') });
        share.lastOutcome='shared';return true;
      }
      if (navigator.share) { await navigator.share({ text: text, title: tr('Photo Note') }); share.lastOutcome='shared';return true; }
    } catch (e) {
      share.lastOutcome=e&&e.name==='AbortError'?'canceled':'failed';
      return false;
    }
    // Fallback: download the photo (to attach) and open a pre-filled email.
    if (file) {
      try {
        var u = URL.createObjectURL(file);
        var a = document.createElement('a'); a.href = u; a.download = file.name || 'photo.jpg';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 1500);
      } catch (e2) {}
    }
    var body = encodeURIComponent(text + (file ? '\n\n' + tr('(Attach the photo just downloaded to this email.)') : ''));
    window.location.href = 'mailto:?subject=' + encodeURIComponent(tr('Photo Note')) + '&body=' + body;
    toast(file ? 'Opened email; photo downloaded to attach' : 'Opened email');
  }

  function showCaptureResult(modal, receipt, outcome) {
    var messages={shared:'The device reported that sharing completed. It does not identify the destination app or confirm email delivery.',canceled:'Sharing was canceled. Your photo and notes remain in Capture.',failed:'Sharing failed. Your photo and notes remain in Capture.',prepared:'An email draft was opened. Sending is not confirmed. Attach the downloaded photo and send it from your email app. Your photo and notes remain in Capture.'};
    modal.innerHTML='<section class="export-share-dialog" role="alertdialog" aria-modal="true" aria-labelledby="captureResultTitle" aria-describedby="captureDeliveryResult captureSaveResult" style="background:#fff;color:#000;text-align:left;font-family:Arial,Helvetica,sans-serif"><h2 id="captureResultTitle">'+tr('PhotoNote result')+'</h2><p id="captureDeliveryResult" style="color:#000"></p><p id="captureSaveResult" aria-live="polite" style="color:#000"></p><button class="btn" id="captureResultOK" type="button">'+tr('OK')+'</button></section>';
    modal.querySelector('#captureDeliveryResult').textContent=tr(messages[outcome]||messages.failed);
    function update(){if(!modal.isConnected){clearInterval(timer);return;}modal.querySelector('#captureSaveResult').textContent=tr(receipt?.uploaded?'Also saved to your Photo Notes account. Find it in Library.':'Also saved on this device in the pending upload queue. It will appear in Library after upload succeeds.');}
    update();var timer=setInterval(update,500),ok=modal.querySelector('#captureResultOK');
    ok.onclick=function(){clearInterval(timer);modal.remove();q('send')?.focus();};
    modal.onkeydown=function(e){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();}if(e.key==='Tab'){e.preventDefault();ok.focus();}};
    ok.focus();
  }
  function showSavedShare(file, text) {
    var capture = typeof state !== 'undefined' ? {photo:state.photoFile,note:noteVal(),account:state.me?.email,edition:selectedEdition()} : null;
    var receipt=typeof state!=='undefined'?state._captureShareSave?.receipt:null;
    document.getElementById('captureShareDialog')?.remove();
    var modal = document.createElement('div');modal.id='captureShareDialog';modal.className='export-share-modal';
    modal.innerHTML='<section class="export-share-dialog" role="dialog" aria-modal="true" aria-labelledby="captureShareTitle"><h2 id="captureShareTitle">'+tr('Photo saved on this device')+'</h2><p>'+tr('After successful sharing, Capture clears for the next photo. Canceling keeps your photo and notes here.')+'</p><button class="btn" data-share>'+tr('Share')+'</button><button class="btn secondary" data-close>'+tr('Close')+'</button></section>';
    var close=function(){modal.remove();q('send')?.focus();};
    modal.querySelector('[data-close]').onclick=close;
    modal.querySelector('[data-share]').onclick=async function(){this.disabled=true;try{if(await share(file,text)){if(capture&&state.view==='capture'&&state.photoFile===capture.photo&&noteVal()===capture.note&&state.me?.email===capture.account&&selectedEdition()===capture.edition){clearCompletedCapture();lastFile=null;}}showCaptureResult(modal,receipt,share.lastOutcome);}finally{this.disabled=false;}};
    modal.onkeydown=function(e){if(e.key==='Escape')close();if(e.key==='Tab'){var buttons=modal.querySelectorAll('button');if(e.shiftKey&&document.activeElement===buttons[0]){e.preventDefault();buttons[1].focus();}else if(!e.shiftKey&&document.activeElement===buttons[1]){e.preventDefault();buttons[0].focus();}}};
    document.body.appendChild(modal);modal.querySelector('[data-share]').focus();
  }
  var sending = false;
  function shareKey(){return JSON.stringify([noteVal(),q('addr')?.textContent,q('gps')?.textContent,typeof state==='undefined'?null:state.me?.email,typeof state==='undefined'?null:state.proType,typeof state==='undefined'?null:state.area,locale()]);}
  var basicShare=null;
  function basicMode(){return typeof isBasicClient==='function'&&isBasicClient();}
  function recording(){return (typeof dictationActive!=='undefined'&&dictationActive)||(typeof dictationFinish!=='undefined'&&!!dictationFinish);}
  // Prepare the captioned image before the tap, preserving native share activation.
  function prepareBasicShare(){
    if(!basicMode()||!q('send'))return;
    var file=state.photoFile,key=shareKey(),button=q('send');
    if(!basicShare||basicShare.original!==file||basicShare.key!==key){
      var item={original:file,key:key,text:caption(),file:file,pending:false};
      basicShare=item;
      if(file&&window.PhotoNotesShareImage){
        item.pending=true;
        window.PhotoNotesShareImage.withDetails(file,item.text).then(function(result){item.file=result;},function(){item.failed=true;}).finally(function(){item.pending=false;prepareBasicShare();});
      }
    }
    button.disabled=sending||basicShare.pending||recording();
  }
  async function sendBasic(){
    prepareBasicShare();
    if(sending||basicShare.pending||recording())return;
    if(!basicShare.original&&!noteVal()){toast('Take a photo or add a note first');return;}
    if(basicShare.failed){basicShare=null;toast('Could not share. Your photo and notes are still here.');return;}
    sending=true;q('send').disabled=true;
    try{var before={photo:state.photoFile,note:noteVal()};if(await share(basicShare.file,basicShare.text)){if(state.photoFile===before.photo&&noteVal()===before.note){clearCompletedCapture();lastFile=null;basicShare=null;}}}
    catch(e){toast('Could not share. Your photo and notes are still here.');}
    finally{sending=false;prepareBasicShare();}
  }
  async function onSend() {
    if(basicMode())return sendBasic();
    if(sending)return;
    var f=typeof state!=='undefined'?state.photoFile:lastFile,t;
    if (!f && !noteVal()) { toast('Take a photo or add a note first'); return; }
    sending=true;var button=q('send'),save=q('save');if(button)button.disabled=true;if(save)save.disabled=true;
    try {
      var saved=await saveCapture({requireDurable:true,preserveDraft:true});
      if(!saved)return;
      t=caption();
      if(f&&window.PhotoNotesShareImage){try{f=await window.PhotoNotesShareImage.withDetails(f,t);}catch(e){toast(e.message);}}
      if(typeof state!=='undefined'&&state.view&&state.view!=='capture')return;
      showSavedShare(f,t);
    } catch(e){toast('Could not save this photo. Your draft is still here.');}
    finally{sending=false;if(q('send'))q('send').disabled=false;if(q('save'))q('save').disabled=false;}
  }
  function injectButtons() {
    var save = q('save'), button = q('send');
    if (!save && !button) return;
    if (!button) {
      button=document.createElement('button');button.id='send';button.className='btn secondary';button.type='button';button.textContent=tr('Send/Share');
      save.insertAdjacentElement('afterend',button);
    }
    if (!button.dataset.captureShareBound) {
      button.dataset.captureShareBound='true';
      button.addEventListener('click',onSend);
    }
  }

  function fixLogo() {
    var img = document.querySelector('img[src="/zukor-logo.svg"]');
    if (!img) return;
    var p = img.parentElement;
    if (!p) return;
    // The current app header owns its responsive logo dimensions in CSS.
    // Do not leave legacy inline dimensions that override the iPhone rules.
    if (p.classList.contains('app-header')) {
      img.style.removeProperty('height');
      img.style.removeProperty('width');
      return;
    }
    img.style.height = '12px'; // legacy non-app header logo height
    img.style.width = 'auto';
    var logout = q('logout');
    var account = p.querySelector('.account-menu-wrap');
    if ((logout && p.contains(logout)) || account) {
      // app header: logo far left, account menu far right
      p.style.display = 'flex'; p.style.flexDirection = 'row';
      p.style.justifyContent = 'space-between'; p.style.alignItems = 'center'; p.style.gap = '6px';
    } else {
      // login header: logo far left
      p.style.display = 'flex'; p.style.justifyContent = 'flex-start';
    }
  }

  // Collapse the Topic area behind a single tappable line. Collapsed it shows
  // "Topic" plus the current selection and a chevron; tapping expands to the
  // chips (one scrollable row) and the add-a-topic field. Purely presentational.
  var topicExpanded = false;
  var topicCollapseHooked = false;
  function fixTopics() {
    var areas = q('areas');
    if (!areas || areas.closest?.('#captureTopic')) return; // Native disclosure handles Capture topics.
    var label = areas.previousElementSibling;                 // the "Topic" <label>
    if (!label || label.tagName !== 'LABEL') return;
    var input = q('newarea');
    var addRow = input ? input.parentElement : null;          // add-a-topic row

    // chips on one scrollable row; hide the "No topics yet" hint
    areas.style.flexWrap = 'nowrap';
    areas.style.overflowX = 'auto';
    areas.style.webkitOverflowScrolling = 'touch';
    areas.style.marginTop = '4px';
    for (var i = 0; i < areas.children.length; i++) areas.children[i].style.flex = '0 0 auto';
    var hint = areas.querySelector('.status');
    if (hint) hint.style.display = 'none';

    // the label becomes the toggle, showing the current selection when collapsed
    var onPill = areas.querySelector('.pill.on');
    var sel = onPill ? (onPill.getAttribute('data-area') || '') : '';
    label.style.cursor = 'pointer';
    var topicHeading = label.getAttribute('data-topic-heading') || 'Select Topic';
    label.style.textTransform = 'none';
    label.style.margin = '6px 0 0';
    label.style.userSelect = 'none';
    // Render in the current language so the translation observer cannot fight
    // this observer by repeatedly replacing the same label.
    var want = tr(topicHeading) + (sel ? ': ' + tr(sel) : '') + ' ' + (topicExpanded ? '▴' : '▾');
    if (label.textContent !== want) label.textContent = want; // guard: avoid observer loop
    label.onclick = function () { topicExpanded = !topicExpanded; fixTopics(); };

    // show/hide the expandable parts
    areas.style.display = topicExpanded ? 'flex' : 'none';
    if (addRow) addRow.style.display = topicExpanded ? '' : 'none';

    // tapping a chip selects it and re-collapses (the new selection then shows)
    if (!topicCollapseHooked) {
      topicCollapseHooked = true;
      document.addEventListener('click', function (e) {
        var t = e.target;
        if (t && t.closest) {
          var pill = t.closest('#areas [data-area]');
          if (pill && !t.getAttribute('data-del')) topicExpanded = false;
        }
      }, true);
    }
  }

  function apply() { injectButtons(); fixLogo(); fixTopics(); prepareBasicShare(); }
  var mo = new MutationObserver(apply);
  mo.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('input', function(e){if(e.target&&e.target.id==='note')prepareBasicShare();});
  document.addEventListener('DOMContentLoaded', apply);
  document.addEventListener('photo-notes-languagechange', apply);
  apply();
})();

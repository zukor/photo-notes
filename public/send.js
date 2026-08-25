// Photo Notes add-on (loaded after app.js):
//  1. Adds "Send" and "Send & Save" buttons under the Save button on the Capture
//     screen. Send opens the device's native share sheet (Messages, Mail,
//     WhatsApp, AirDrop, etc.) with the photo + caption; Send & Save also commits
//     the record to the Library. Falls back to email + photo download where the
//     Web Share API is unavailable (some desktop browsers).
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
  function noteVal() { return q('note') ? q('note').value.trim() : ''; }

  var stateAbbr = { Alabama:'AL', Alaska:'AK', Arizona:'AZ', Arkansas:'AR', California:'CA', Colorado:'CO', Connecticut:'CT', Delaware:'DE', Florida:'FL', Georgia:'GA', Hawaii:'HI', Idaho:'ID', Illinois:'IL', Indiana:'IN', Iowa:'IA', Kansas:'KS', Kentucky:'KY', Louisiana:'LA', Maine:'ME', Maryland:'MD', Massachusetts:'MA', Michigan:'MI', Minnesota:'MN', Mississippi:'MS', Missouri:'MO', Montana:'MT', Nebraska:'NE', Nevada:'NV', 'New Hampshire':'NH', 'New Jersey':'NJ', 'New Mexico':'NM', 'New York':'NY', 'North Carolina':'NC', 'North Dakota':'ND', Ohio:'OH', Oklahoma:'OK', Oregon:'OR', Pennsylvania:'PA', 'Rhode Island':'RI', 'South Carolina':'SC', 'South Dakota':'SD', Tennessee:'TN', Texas:'TX', Utah:'UT', Vermont:'VT', Virginia:'VA', Washington:'WA', 'West Virginia':'WV', Wisconsin:'WI', Wyoming:'WY', 'District of Columbia':'DC' };
  function shortState(address) {
    var value = String(address || '').trim();
    Object.keys(stateAbbr).forEach(function (name) { value = value.replace(new RegExp('\\b' + name + '\\b', 'g'), stateAbbr[name]); });
    return value;
  }

  function caption() {
    var parts = [];
    var addr = q('addr') ? q('addr').textContent.trim() : '';
    if (addr && addr.indexOf('...') === -1 && !/^(address not found|address lookup)/i.test(addr)) {
      parts.push(shortState(addr));
    } else {
      var g = q('gps') ? q('gps').textContent.trim() : '';
      if (g && /\d/.test(g) && !/blocked|not available|getting/i.test(g)) parts.push(g);
    }
    var n = noteVal(); if (n) parts.push(n);
    parts.push(new Date().toLocaleString());
    return parts.join('\n');
  }

  function toast(m) {
    var t = q('toast');
    if (t) { t.textContent = m; t.style.display = 'block'; setTimeout(function () { t.style.display = 'none'; }, 2200); }
  }

  async function share(file, text) {
    try {
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: text, title: 'Photo Note' });
        return;
      }
      if (navigator.share) { await navigator.share({ text: text, title: 'Photo Note' }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    // Fallback: download the photo (to attach) and open a pre-filled email.
    if (file) {
      try {
        var u = URL.createObjectURL(file);
        var a = document.createElement('a'); a.href = u; a.download = file.name || 'photo.jpg';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 1500);
      } catch (e2) {}
    }
    var body = encodeURIComponent(text + (file ? '\n\n(Attach the photo just downloaded to this email.)' : ''));
    window.location.href = 'mailto:?subject=' + encodeURIComponent('Photo Note') + '&body=' + body;
    toast(file ? 'Opened email; photo downloaded to attach' : 'Opened email');
  }

  function onSend() {
    if (!lastFile && !noteVal()) { toast('Take a photo or add a note first'); return; }
    share(lastFile, caption());
  }
  function onSendSave() {
    if (!lastFile && !noteVal()) { toast('Take a photo or add a note first'); return; }
    var f = lastFile, t = caption();
    var s = q('save'); if (s) s.click(); // app's Save: commit + background upload
    share(f, t);
  }

  function injectButtons() {
    var save = q('save');
    if (!save || q('send')) return; // capture screen only, once
    var b1 = document.createElement('button');
    b1.id = 'send'; b1.className = 'btn secondary slim'; b1.type = 'button'; b1.textContent = 'Send';
    b1.addEventListener('click', onSend);
    var b2 = document.createElement('button');
    b2.id = 'sendsave'; b2.className = 'btn secondary slim'; b2.type = 'button'; b2.textContent = 'Send & Save';
    b2.addEventListener('click', onSendSave);
    var row = document.createElement('div');
    row.className = 'send-row';
    row.appendChild(b1); row.appendChild(b2);
    save.insertAdjacentElement('afterend', row);
  }

  function fixLogo() {
    var img = document.querySelector('img[src="/zukor-logo.svg"]');
    if (!img) return;
    img.style.height = '12px'; // corner logo height
    img.style.width = 'auto';
    var p = img.parentElement;
    if (!p) return;
    if (p.classList.contains('app-header')) return;
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
    if (!areas) return; // capture screen only
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
    label.style.textTransform = 'none';
    label.style.margin = '12px 0 0';
    label.style.userSelect = 'none';
    var want = 'Select Topic' + (sel ? ': ' + sel : '') + '  ' + (topicExpanded ? '▴' : '▾');
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

  function apply() { injectButtons(); fixLogo(); fixTopics(); }
  var mo = new MutationObserver(apply);
  mo.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', apply);
  apply();
})();

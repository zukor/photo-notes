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

  function caption() {
    var parts = [];
    var n = noteVal(); if (n) parts.push(n);
    var addr = q('addr') ? q('addr').textContent.trim() : '';
    if (addr && addr.indexOf('...') === -1 && !/^(address not found|address lookup)/i.test(addr)) {
      parts.push(addr);
    } else {
      var g = q('gps') ? q('gps').textContent.trim() : '';
      if (g && /\d/.test(g) && !/blocked|not available|getting/i.test(g)) parts.push(g);
    }
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
    b1.id = 'send'; b1.className = 'btn secondary'; b1.type = 'button'; b1.textContent = 'Send';
    b1.addEventListener('click', onSend);
    var b2 = document.createElement('button');
    b2.id = 'sendsave'; b2.className = 'btn secondary'; b2.type = 'button'; b2.textContent = 'Send & Save';
    b2.addEventListener('click', onSendSave);
    save.insertAdjacentElement('afterend', b1);
    b1.insertAdjacentElement('afterend', b2);
  }

  function fixLogo() {
    var img = document.querySelector('img[src="/zukor-logo.svg"]');
    if (!img) return;
    img.style.height = '12px'; // corner logo height
    img.style.width = 'auto';
    var p = img.parentElement;
    if (!p) return;
    var logout = q('logout');
    if (logout && p.contains(logout)) {
      // app header: logo far left, Log out far right
      p.style.display = 'flex'; p.style.flexDirection = 'row';
      p.style.justifyContent = 'space-between'; p.style.alignItems = 'center'; p.style.gap = '6px';
    } else {
      // login header: logo far left
      p.style.display = 'flex'; p.style.justifyContent = 'flex-start';
    }
  }

  // Slim the Topic area: keep the chips on one scrollable row and hide the
  // "add a topic" field behind a small "+ New topic" button so it only appears
  // when needed. Purely presentational — the app's own handlers still run.
  function fixTopics() {
    var areas = q('areas');
    if (!areas) return; // capture screen only
    areas.style.flexWrap = 'nowrap';
    areas.style.overflowX = 'auto';
    areas.style.webkitOverflowScrolling = 'touch';
    areas.style.marginTop = '2px';
    for (var i = 0; i < areas.children.length; i++) areas.children[i].style.flex = '0 0 auto';
    // tighten the "Topic" label
    var labels = document.querySelectorAll('label');
    for (var j = 0; j < labels.length; j++) {
      if (labels[j].textContent.trim().toLowerCase() === 'topic') { labels[j].style.margin = '10px 0 2px'; break; }
    }
    // hide the "No topics yet" hint (the + button below conveys it)
    var hint = areas.querySelector('.status');
    if (hint) hint.style.display = 'none';
    // collapse the add-topic row behind a compact toggle
    var input = q('newarea');
    var addRow = input ? input.parentElement : null;
    if (addRow && !q('topicAddToggle')) {
      addRow.style.display = 'none';
      var tog = document.createElement('button');
      tog.id = 'topicAddToggle'; tog.type = 'button'; tog.className = 'pill';
      tog.textContent = '+ New topic'; tog.style.marginTop = '6px'; tog.style.cursor = 'pointer';
      tog.addEventListener('click', function () {
        addRow.style.display = ''; tog.style.display = 'none'; if (input) input.focus();
      });
      areas.insertAdjacentElement('afterend', tog);
    }
  }

  function apply() { injectButtons(); fixLogo(); fixTopics(); }
  var mo = new MutationObserver(apply);
  mo.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', apply);
  apply();
})();

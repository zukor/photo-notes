(function(){
  'use strict';
  // In-app replacements for the browser's confirm() and prompt() dialogs, which iPhone
  // Safari and the iPhone app show poorly and which cannot be translated or styled.
  // pnConfirm({title, message, confirmLabel, cancelLabel, danger}) resolves true or false.
  // pnPrompt({title, message, label, value, placeholder, confirmLabel, cancelLabel, multiline}) resolves the text or null.
  function t(text){ return (window.photoNotesI18n && typeof window.photoNotesI18n.t === 'function') ? window.photoNotesI18n.t(text) : text; }
  function esc(value){ return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  let open = null;
  function close(dialog, result, resolve){
    if (dialog.dataset.done) return;
    dialog.dataset.done = '1';
    try { if (dialog.open) dialog.close(); } catch (e) {}
    dialog.remove();
    if (open === dialog) open = null;
    resolve(result);
  }
  function show(options, kind){
    const o = options || {};
    return new Promise(resolve => {
      if (open) { try { open.close(); } catch (e) {} open.remove(); open = null; }
      const dialog = document.createElement('dialog');
      dialog.className = 'pn-confirm-dialog' + (o.danger ? ' danger' : '');
      dialog.setAttribute('aria-labelledby', 'pnConfirmTitle');
      const confirmLabel = o.confirmLabel || (kind === 'prompt' ? 'Save' : (o.danger ? 'Delete' : 'OK'));
      const cancelLabel = o.cancelLabel || 'Cancel';
      const field = kind === 'prompt'
        ? `<label class="pn-confirm-label" for="pnPromptValue">${esc(t(o.label || ''))}</label>${o.multiline
          ? `<textarea id="pnPromptValue" rows="3" placeholder="${esc(t(o.placeholder || ''))}">${esc(o.value || '')}</textarea>`
          : `<input id="pnPromptValue" type="text" value="${esc(o.value || '')}" placeholder="${esc(t(o.placeholder || ''))}" autocomplete="off">`}`
        : '';
      dialog.innerHTML = `<form method="dialog" class="pn-confirm-form">
        <h2 id="pnConfirmTitle">${esc(t(o.title || (kind === 'prompt' ? 'Enter a Value' : 'Please Confirm')))}</h2>
        ${o.message ? `<p class="pn-confirm-message">${esc(t(o.message))}</p>` : ''}
        ${field}
        <div class="pn-confirm-actions">
          <button type="button" class="btn secondary" id="pnConfirmCancel">${esc(t(cancelLabel))}</button>
          <button type="submit" class="btn${o.danger ? ' danger' : ''}" id="pnConfirmOk">${esc(t(confirmLabel))}</button>
        </div>
      </form>`;
      const input = dialog.querySelector('#pnPromptValue');
      dialog.querySelector('#pnConfirmCancel').addEventListener('click', () => close(dialog, kind === 'prompt' ? null : false, resolve));
      dialog.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        if (kind === 'prompt') {
          const value = input ? String(input.value || '').trim() : '';
          if (o.required !== false && !value) { if (input) input.focus(); return; }
          close(dialog, value, resolve);
        } else close(dialog, true, resolve);
      });
      // Escape, the backdrop and the browser's own close all count as Cancel.
      dialog.addEventListener('cancel', event => { event.preventDefault(); close(dialog, kind === 'prompt' ? null : false, resolve); });
      dialog.addEventListener('close', () => close(dialog, kind === 'prompt' ? null : false, resolve));
      dialog.addEventListener('click', event => { if (event.target === dialog) close(dialog, kind === 'prompt' ? null : false, resolve); });
      document.body.append(dialog);
      open = dialog;
      try { dialog.showModal(); } catch (e) { dialog.setAttribute('open', ''); }
      const focusTarget = input || dialog.querySelector(o.danger ? '#pnConfirmCancel' : '#pnConfirmOk');
      if (focusTarget) { focusTarget.focus(); if (input && typeof input.select === 'function' && !o.multiline) input.select(); }
    });
  }
  window.pnConfirm = options => show(options, 'confirm');
  window.pnPrompt = options => show(options, 'prompt');
})();

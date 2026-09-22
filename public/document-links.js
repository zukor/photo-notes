(function () {
  const tr = text => window.photoNotesI18n?.t(text) || text;
  function element(tag, text, parent) {
    const el = document.createElement(tag);
    if (text) el.textContent = tr(text);
    parent?.appendChild(el);
    return el;
  }
  function button(text, parent, action) {
    const el = element('button', text, parent);
    el.type = 'button';
    el.className = 'btn secondary';
    el.onclick = action;
    return el;
  }
  async function request(path, options = {}) {
    const response = await fetch(path, {credentials:'same-origin', ...options});
    const data = await response.json();
    if (!response.ok) throw Error(tr(data.error || 'Could not create the link. Please try again.'));
    return data;
  }
  function linkControls(parent, row) {
    const url = new URL(row.path, location.origin).href;
    const input = element('input', null, parent);
    input.type = 'text'; input.readOnly = true; input.value = url;
    input.setAttribute('aria-label', tr('Document download link'));
    const status = element('p', null, parent);
    status.setAttribute('role','status');
    const actions = element('div', null, parent); actions.className = 'row';
    button('Copy link', actions, async () => {
      try {await navigator.clipboard.writeText(url); status.textContent = tr('Link copied. Paste it in Teams, WhatsApp, or email.');}
      catch {input.focus(); input.select(); status.textContent = tr('Select and copy the link, then paste it in your message.');}
    });
    if (navigator.share) button('Share link', actions, async () => {
      try {
        // Keep this in the click handler; creating a link must not consume activation.
        await navigator.share({title:row.filename,url});
        status.textContent = tr('Link shared.');
      } catch (error) {
        status.textContent = tr(error?.name === 'AbortError' ? 'Sharing was canceled. You can try again or copy the link.' : 'Copy the link and paste it in Teams, WhatsApp, or email.');
      }
    });
    const expiry = element('p', null, parent);
    element('span','Link expires:',expiry);
    expiry.appendChild(document.createTextNode(' '+new Date(row.expires_at).toLocaleString()));
  }
  function mount(parent, file, format) {
    const section = element('section', null, parent); section.className = 'document-link-panel';
    element('strong', 'Send Word or ZIP without downloading first', section);
    element('p', 'Create a link to this file and send it in Teams, WhatsApp, or email. Anyone with the link can download it for 7 days. Revoke it from Shared document links in Send.', section);
    const status = element('p', null, section); status.setAttribute('role','status');
    const create = button('Create share link', section, async () => {
      create.disabled = true;
      status.textContent = tr('Creating link...');
      try {
        const row = await request('/api/document-links?'+new URLSearchParams({format,name:file.name}), {
          method:'POST',headers:{'Content-Type':'application/octet-stream','X-Photo-Notes-Share':'1'},body:file,
        });
        create.remove(); status.textContent = tr('Link ready. Share or copy it below.');
        linkControls(section,row);
      } catch(error) {status.textContent = error.message; create.disabled = false;}
    });
  }
  async function manage(parent) {
    parent.replaceChildren();
    parent.classList.add('document-link-panel');
    const status = element('p','Loading shared links...',parent); status.setAttribute('role','status');
    try {
      const rows = await request('/api/document-links');
      status.textContent = rows.length ? tr('Anyone with a link can download that file until it expires or you revoke it.') : tr('No active shared links.');
      for (const row of rows) {
        const card = element('article',null,parent); card.className = 'card';
        element('strong',null,card).textContent = row.filename;
        linkControls(card,row);
        button('Revoke link',card,async event=>{
          const btn = event.currentTarget; btn.disabled=true;
          try {
            await request('/api/document-links/'+row.id,{method:'DELETE',headers:{'X-Photo-Notes-Share':'1'}});
            card.remove(); status.textContent=tr('Link revoked. Recipients can no longer download the file through this link.');
          } catch(error) {status.textContent=error.message;btn.disabled=false;}
        });
      }
    } catch(error) {status.textContent=error.message;}
  }
  window.PhotoNotesDocumentLinks = {mount,manage};
})();

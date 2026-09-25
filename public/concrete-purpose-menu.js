// A full-width photo-purpose menu avoids the narrow native iPhone select popup.
(function () {
  let active = null;
  function close(restoreFocus = false) {
    if (!active) return;
    const {button, menu} = active;
    active = null;
    menu.remove();
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus && button.isConnected) button.focus();
  }
  function mount(select) {
    close();
    let button = document.getElementById('concretePurposeButton');
    if (!button) {
      button = document.createElement('button');
      button.id = 'concretePurposeButton';
      button.type = 'button';
      button.className = 'concrete-purpose-button';
      button.setAttribute('aria-haspopup', 'listbox');
      button.setAttribute('aria-controls', 'concretePurposeMenu');
      button.setAttribute('aria-describedby', 'concretePhotoGuide');
      select.after(button);
      select.hidden = true;
      document.querySelector('label[for="concretePurpose"]').htmlFor = button.id;
    }
    button.disabled = select.disabled;
    button.setAttribute('aria-expanded', 'false');
    button.textContent = select.selectedOptions[0]?.textContent || '';
    button.onclick = () => {
      if (active) { close(); return; }
      const menu = document.createElement('div');
      menu.id = 'concretePurposeMenu';
      menu.className = 'concrete-purpose-menu';
      menu.setAttribute('role', 'listbox');
      menu.setAttribute('aria-label', window.photoNotesI18n?.t('Photo purpose') || 'Photo purpose');
      for (const option of select.options) {
        const item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.selected));
        item.tabIndex = option.selected ? 0 : -1;
        item.textContent = option.textContent;
        item.onclick = () => {
          select.value = option.value;
          button.textContent = option.textContent;
          select.dispatchEvent(new Event('change', {bubbles: true}));
          close(true);
        };
        menu.append(item);
      }
      document.body.append(menu);
      const rect = button.getBoundingClientRect();
      const viewport = window.visualViewport;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      const offsetLeft = viewport?.offsetLeft || 0;
      const offsetTop = viewport?.offsetTop || 0;
      const menuWidth = Math.min(Math.max(rect.width, 440), width - 24);
      menu.style.width = `${menuWidth}px`;
      menu.style.left = `${Math.max(offsetLeft + 12, Math.min(rect.left, offsetLeft + width - menuWidth - 12))}px`;
      const below = height + offsetTop - rect.bottom - 12;
      const above = rect.top - offsetTop - 12;
      const openAbove = below < 220 && above > below;
      const available = Math.max(96, openAbove ? above : below);
      menu.style.maxHeight = `${Math.min(420, available)}px`;
      menu.style.top = `${openAbove ? Math.max(offsetTop + 12, rect.top - Math.min(menu.scrollHeight, 420, available) - 4) : rect.bottom + 4}px`;
      active = {button, menu};
      menu.querySelector('[aria-selected="true"]')?.focus({preventScroll: true});
      menu.onkeydown = event => {
        const items = Array.from(menu.children), index = items.indexOf(document.activeElement);
        let next;
        if (event.key === 'ArrowDown') next = (index + 1) % items.length;
        else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = items.length - 1;
        else if (event.key === 'Tab') { close(true); return; }
        else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== ' ') {
          const ordered = [...items.slice(index + 1), ...items.slice(0, index + 1)];
          const match = ordered.find(item => item.textContent.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
          if (match) next = items.indexOf(match);
        }
        if (next !== undefined) { event.preventDefault(); items[next].focus(); }
      };
    };
    button.onkeydown = event => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); button.click(); }
    };
  }
  document.addEventListener('pointerdown', event => {
    if (active && !active.menu.contains(event.target) && !active.button.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    if (active && event.key === 'Escape') { event.preventDefault(); close(true); }
  });
  window.addEventListener('resize', () => close());
  window.addEventListener('scroll', event => { if (active && !active.menu.contains(event.target)) close(); }, true);
  window.ConcretePurposeMenu = {mount, close};
})();

(() => {
  'use strict';

  // Every edition and dashboard uses the displayed labels, with Sign Out last.
  function sort() {
    const menu = document.getElementById('profileMenu');
    const signout = menu?.querySelector('#signout');
    if (!signout) return;
    const i18n = window.photoNotesI18n;
    const locale = i18n?.getLanguage() || document.documentElement.lang || 'en';
    const label = item => i18n ? i18n.t(item.textContent.trim()) : item.textContent.trim();
    const items = [...menu.children].filter(item => item.matches('a,button') && item !== signout);
    items.sort((a, b) => label(a).localeCompare(label(b), locale, { sensitivity: 'base' }));
    items.push(signout);
    const current = [...menu.children].filter(item => item.matches('a,button'));
    if (items.some((item, index) => item !== current[index])) {
      items.forEach(item => menu.appendChild(item));
    }
  }

  window.PhotoNotesAccountMenu = { sort };
  document.addEventListener('photo-notes-languagechange', sort);
  // Capture runs before the button's handler opens the menu, including after
  // an edition switch has replaced the whole app header.
  document.addEventListener('click', event => {
    if (event.target.closest('#profileButton')) sort();
  }, true);
})();

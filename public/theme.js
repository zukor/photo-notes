// Shared appearance preference. Apply before paint, and after dynamically rendered headers.
(function(){
  const key='photo-notes-theme';
  let theme='light';
  try{theme=localStorage.getItem(key)==='dark'?'dark':'light';}catch{}
  function apply(next,persist){
    theme=next==='dark'?'dark':'light';
    document.documentElement.dataset.theme=theme;
    if(persist)try{localStorage.setItem(key,theme);}catch{}
    document.querySelectorAll('[data-theme-choice]').forEach(button=>{
      const pressed=button.dataset.themeChoice===theme;
      if(button.getAttribute('aria-pressed')!==String(pressed))button.setAttribute('aria-pressed',String(pressed));
    });
  }
  function mount(){
    document.querySelectorAll('.language-switch, [data-theme-host]').forEach(host=>{
      if(host.querySelector('.theme-switch'))return;
      const group=document.createElement('span');group.className='theme-switch';group.setAttribute('role','group');group.setAttribute('aria-label','Appearance');
      group.innerHTML='<button type="button" data-theme-choice="light" title="Light mode" aria-label="Light mode">L</button><button type="button" data-theme-choice="dark" title="Dark mode" aria-label="Dark mode">D</button>';
      host.prepend(group);
    });
    apply(theme,false);
  }
  apply(theme,false);
  document.addEventListener('click',event=>{const button=event.target.closest('[data-theme-choice]');if(button)apply(button.dataset.themeChoice,true);});
  window.addEventListener('storage',event=>{if(event.key===key||event.key===null)apply(event.newValue,false);});
  new MutationObserver(mount).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',mount);
  window.PhotoNotesTheme={set:next=>apply(next,true),get:()=>theme};
})();

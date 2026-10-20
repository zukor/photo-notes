// Shared appearance preference. Apply before paint, and after dynamically rendered headers.
(function(){
  const key='photo-notes-theme';
  // If the white-letter logo request fails, the same logo is loaded from its raster file instead.
  // That file has a black background, so it is blended to show only the white letters.
  const darkLogoFallback='/zukor-logo-dark.jpg?v=1';
  let theme='light';
  try{theme=localStorage.getItem(key)==='dark'?'dark':'light';}catch{}
  function apply(next,persist){
    theme=next==='dark'?'dark':'light';
    document.documentElement.dataset.theme=theme;
    document.querySelectorAll('img[alt="Zukor AI"]').forEach(img=>{
      const light=img.dataset.zukorLightSrc||(img.dataset.zukorLightSrc=img.getAttribute('src'));
      if(!img.dataset.zukorErrorHandler){
        img.dataset.zukorErrorHandler='1';
        img.addEventListener('error',()=>{
          if(theme!=='dark'||img.dataset.zukorFallback==='1')return;
          img.dataset.zukorFallback='1';img.style.mixBlendMode='screen';img.setAttribute('src',darkLogoFallback);
        });
      }
      img.width=448;img.height=72;
      const source=theme==='dark'?(img.dataset.zukorFallback==='1'?darkLogoFallback:'/zukor-logo-dark.svg?v=364'):light;
      const blend=theme==='dark'&&img.dataset.zukorFallback==='1'?'screen':'';if(img.style.mixBlendMode!==blend)img.style.mixBlendMode=blend;
      if(img.getAttribute('src')!==source)img.setAttribute('src',source);
    });
    document.querySelectorAll('.app-header[data-product]:not([data-product="general"]) .photonotes-wordmark').forEach(img=>{const light=img.dataset.photoNotesLightSrc||(img.dataset.photoNotesLightSrc=img.getAttribute('src'));const source=theme==='dark'?'/photonotes-ai-logo-dark.svg?v=1':light;if(img.getAttribute('src')!==source)img.setAttribute('src',source);});
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

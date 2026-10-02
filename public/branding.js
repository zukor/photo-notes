// Match the tier font size to 43% of the displayed logo height.
(function(){
  const watched=new WeakSet();
  function size(img){const tier=img.parentElement?.querySelector('.photonotes-tier');if(tier){const height=img.getBoundingClientRect().height;if(height>0)tier.style.setProperty('--photonotes-tier-size',`${height*.43}px`);}}
  const observer=new ResizeObserver(entries=>entries.forEach(entry=>size(entry.target)));
  function scan(){document.querySelectorAll('.photonotes-wordmark').forEach(img=>{if(!watched.has(img)){watched.add(img);observer.observe(img);img.addEventListener('load',()=>size(img));}size(img);});}
  new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});scan();
})();

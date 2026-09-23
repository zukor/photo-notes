// Render the actual exported Word file in an isolated document. Template styles
// and links must never modify the app or gain access to its authenticated DOM.
window.PhotoNotesWordPreview={
 async render(container,groupId){
  container.textContent='Preparing Word template preview...';
  try{
   const response=await api(`/api/export/docx?group=${encodeURIComponent(groupId)}&res=web`);
   if(!response.ok)throw new Error();
   const buffer=await response.arrayBuffer();if(!container.isConnected)return;
   const frame=document.createElement('iframe');frame.title='Word template preview';frame.className='word-template-preview';frame.setAttribute('sandbox','allow-scripts');
   const origin=location.origin;
   frame.srcdoc=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' ${origin}; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:;"><style>body{margin:0;color:#000;background:white;font-family:Arial}#preview{overflow:auto}.docx-wrapper{padding:8px!important;background:white!important}section.docx{box-shadow:none!important}</style><script src="${origin}/vendor/jszip.min.js"></script><script src="${origin}/vendor/docx-preview.min.js"></script></head><body><div id="preview"></div><script src="${origin}/word-preview-frame.js"></script></body></html>`;
   frame.onload=()=>frame.contentWindow.postMessage(buffer,'*');container.replaceChildren(frame);
  }catch(e){if(container.isConnected)container.textContent='Word preview could not be loaded. Try again or download Word.';}
 }
};

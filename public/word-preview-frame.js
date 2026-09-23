addEventListener('message',async event=>{
 if(event.source!==parent||!(event.data instanceof ArrayBuffer))return;
 try{
  await docx.renderAsync(event.data,document.getElementById('preview'),null,{useBase64URL:true,renderAltChunks:false,ignoreLastRenderedPageBreak:false});
  document.querySelectorAll('a').forEach(a=>a.removeAttribute('href'));
 }catch(error){document.getElementById('preview').textContent='Preview unavailable. Download Word to view the template.';}
});

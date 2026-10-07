(function(root){
 const templates={date_address:[{t:'datetime',x:4,y:4,size:3,color:'#ffffff',font:'sans',outline:true},{t:'address',x:4,y:11,size:3,color:'#ffffff',font:'sans',outline:true}],evidence:[{t:'datetime',x:4,y:4,size:2.5,color:'#ffffff',font:'sans',outline:true},{t:'address',x:4,y:10,size:2.5,color:'#ffffff',font:'sans',outline:true},{t:'gps',x:4,y:16,size:2.5,color:'#ffffff',font:'sans',outline:true},{t:'copyright',x:4,y:92,size:2.2,color:'#ffffff',font:'sans',outline:true}],copyright:[{t:'copyright',x:4,y:92,size:2.2,color:'#ffffff',font:'sans',outline:true}]};
 if(typeof module==='object'&&module.exports)module.exports=templates;else root.PhotoNotesAnnotationTemplates=templates;
})(typeof window==='object'?window:globalThis);

(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PhotoNotesQueue=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const editions=['basic','pro','contractor','roads','paving','hoa','concrete','roofer'];
  async function accountKey(email){
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(email||'').trim().toLowerCase()));
    return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  }
  function open(){return new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB)return reject(Error('Local storage unavailable'));
    const request=indexedDB.open('photo-notes-offline',1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('captures'))request.result.createObjectStore('captures',{keyPath:'id',autoIncrement:true});};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Close other Photo Notes tabs and try again'));
  });}
  async function transaction(mode,operation){
    const db=await open();
    return new Promise((resolve,reject)=>{
      let request,tx;
      try{tx=db.transaction('captures',mode);request=operation(tx.objectStore('captures'));}
      catch(error){db.close();reject(error);return;}
      tx.oncomplete=()=>{db.close();resolve(request.result);};
      tx.onabort=tx.onerror=()=>{db.close();reject(tx.error||request.error||Error('Local save interrupted'));};
    });
  }
  async function create(payload,hadCoords,account,edition){
    if(!/^[a-f0-9]{64}$/.test(account)||!editions.includes(edition))throw Error('Sign in and select an authorized version first');
    const row={account,edition,requestId:crypto.randomUUID(),payload,hadCoords:!!hadCoords,createdAt:Date.now()};
    // Store bytes instead of a File handle. WebKit can abort File/Blob transactions.
    const stored={...row,payload:{...payload}};
    if(payload.photo){stored.photoBytes=await payload.photo.arrayBuffer();stored.photoType=payload.photo.type;stored.payload.photo=null;}
    row.id=await transaction('readwrite',store=>store.add(stored));return row;
  }
  const all=async()=>{const rows=await transaction('readonly',store=>store.getAll());return rows.map(row=>{if(row.photoBytes){row.payload.photo=new Blob([row.photoBytes],{type:row.photoType||'image/jpeg'});delete row.photoBytes;}return row;});};
  const remove=id=>transaction('readwrite',store=>store.delete(id));
  const eligible=(row,account,edition)=>row.account===account&&row.edition===edition&&/^[a-f0-9-]{36}$/.test(row.requestId||'');
  const headers=row=>({'X-Photo-Notes-Capture-Id':row.requestId,'X-Photo-Notes-Edition':row.edition,'X-Photo-Notes-Account':row.account});
  const permanent=status=>[400,401,403,409,413,422].includes(status);
  return {accountKey,create,all,remove,eligible,headers,permanent};
});

(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PhotoNotesQueue=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const editions=['basic','security','issue','pro','contractor','roads','paving','hoa','property','concrete','roofer'];
  async function accountKey(email){
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(email||'').trim().toLowerCase()));
    return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  }
  // Version 3 keeps each pending photo's bytes in their own store, so listing pending PhotoNotes
  // reads only details and a small preview. Rows saved by earlier versions keep their bytes in the
  // row until they are moved one at a time (migrate), and every read below accepts both layouts.
  function open(){return new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB)return reject(Error('Local storage unavailable'));
    const request=indexedDB.open('photo-notes-offline',3);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('drafts'))db.createObjectStore('drafts',{keyPath:'key'});if(!db.objectStoreNames.contains('captures'))db.createObjectStore('captures',{keyPath:'id',autoIncrement:true});if(!db.objectStoreNames.contains('photos'))db.createObjectStore('photos',{keyPath:'id'});};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Close other Photo Notes tabs and try again'));
  });}
  async function transaction(mode,operation,storeName='captures'){
    const db=await open();
    return new Promise((resolve,reject)=>{
      let request,tx;
      try{tx=db.transaction(storeName,mode);request=operation(Array.isArray(storeName)?tx:tx.objectStore(storeName),tx);}
      catch(error){db.close();reject(error);return;}
      tx.oncomplete=()=>{db.close();resolve(request&&'result' in request?request.result:request);};
      tx.onabort=tx.onerror=()=>{db.close();reject(tx.error||request?.error||Error('Local save interrupted'));};
    });
  }
  // A small JPEG preview for the Pending list. Returns null where the browser cannot make one.
  async function makeThumbnail(blob,max=640){
    try{
      if(!blob||typeof createImageBitmap!=='function'||(blob.type&&!/^image\//.test(blob.type)))return null;
      const bitmap=await createImageBitmap(blob),scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height)),w=Math.max(1,Math.round(bitmap.width*scale)),h=Math.max(1,Math.round(bitmap.height*scale));
      let canvas;
      if(typeof OffscreenCanvas==='function')canvas=new OffscreenCanvas(w,h);
      else if(typeof document!=='undefined'){canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;}
      if(!canvas){bitmap.close?.();return null;}
      canvas.getContext('2d').drawImage(bitmap,0,0,w,h);bitmap.close?.();
      const out=canvas.convertToBlob?await canvas.convertToBlob({type:'image/jpeg',quality:0.72}):await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.72));
      return out?{bytes:await out.arrayBuffer(),type:out.type||'image/jpeg'}:null;
    }catch{return null;}
  }
  // Store the preview on the row after the PhotoNote is safely saved. A missing preview never blocks a save.
  async function addThumbnail(id,blob){
    const thumb=await makeThumbnail(blob);if(!thumb)return false;
    await transaction('readwrite',store=>{const get=store.get(id);get.onsuccess=()=>{const row=get.result;if(row&&!row.thumbBytes){row.thumbBytes=thumb.bytes;row.thumbType=thumb.type;store.put(row);}};return get;});
    return true;
  }
  async function create(payload,hadCoords,account,edition){
    if(!/^[a-f0-9]{64}$/.test(account)||!editions.includes(edition))throw Error('Sign in and select an authorized version first');
    const row={account,edition,requestId:crypto.randomUUID(),payload,hadCoords:!!hadCoords,createdAt:Date.now()};
    // Store bytes instead of a File handle. WebKit can abort File/Blob transactions.
    const stored={...row,payload:{...payload}};let photo=null;
    if(payload.photo){photo={bytes:await payload.photo.arrayBuffer(),type:payload.photo.type};stored.payload.photo=null;stored.hasPhoto=true;}
    // The details and the photo bytes commit together or not at all.
    row.id=await transaction('readwrite',tx=>{const add=tx.objectStore('captures').add(stored);if(photo)add.onsuccess=()=>tx.objectStore('photos').put({id:add.result,bytes:photo.bytes,type:photo.type});return add;},['captures','photos']);
    if(photo){row.hasPhoto=true;void addThumbnail(row.id,payload.photo).catch(()=>{});}
    return row;
  }
  // Pending PhotoNote details without photo bytes. Earlier rows that still hold their bytes are read one at a time.
  async function list(){
    const rows=[];
    await transaction('readonly',store=>{const cursor=store.openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(!c)return;const row=c.value;if(row.photoBytes){delete row.photoBytes;row.hasPhoto=true;row.legacyPhoto=true;}rows.push(row);c.continue();};return cursor;});
    return rows;
  }
  function thumbnailBlob(row){return row&&row.thumbBytes?new Blob([row.thumbBytes],{type:row.thumbType||'image/jpeg'}):null;}
  const thumbnail=async id=>thumbnailBlob(await transaction('readonly',store=>store.get(id)));
  // The photo bytes for one pending PhotoNote, from either layout. Null when the PhotoNote has no photo.
  async function photo(id){
    const found=await transaction('readonly',tx=>{const result={};const p=tx.objectStore('photos').get(id);p.onsuccess=()=>{result.photo=p.result;if(!p.result){const r=tx.objectStore('captures').get(id);r.onsuccess=()=>{result.row=r.result;};}};return {get result(){return result;}};},['captures','photos']);
    if(found.photo)return new Blob([found.photo.bytes],{type:found.photo.type||'image/jpeg'});
    if(found.row&&found.row.photoBytes)return new Blob([found.row.photoBytes],{type:found.row.photoType||'image/jpeg'});
    return null;
  }
  // Move one earlier row's bytes into the photo store and add its preview. The move is a single
  // transaction, so a PhotoNote is never left without its photo.
  async function migrate(id){
    const blob=await photo(id);if(!blob)return false;
    const thumb=await makeThumbnail(blob);
    return transaction('readwrite',tx=>{const store=tx.objectStore('captures'),get=store.get(id);const result={moved:false};get.onsuccess=()=>{const row=get.result;if(!row)return;if(row.photoBytes){tx.objectStore('photos').put({id,bytes:row.photoBytes,type:row.photoType||'image/jpeg'});delete row.photoBytes;delete row.photoType;row.hasPhoto=true;result.moved=true;}if(thumb&&!row.thumbBytes){row.thumbBytes=thumb.bytes;row.thumbType=thumb.type;}store.put(row);};return {get result(){return result.moved;}};},['captures','photos']);
  }
  // Every pending PhotoNote with its photo, as earlier versions returned them.
  const all=async()=>{const rows=await list();for(const row of rows){if(row.hasPhoto)row.payload.photo=await photo(row.id);delete row.legacyPhoto;delete row.thumbBytes;delete row.thumbType;}return rows;};
  const remove=id=>transaction('readwrite',tx=>{tx.objectStore('photos').delete(id);return tx.objectStore('captures').delete(id);},['captures','photos']);
  const eligible=(row,account,edition)=>row.account===account&&row.edition===edition&&/^[a-f0-9-]{36}$/.test(row.requestId||'');
  const headers=row=>({'X-Photo-Notes-Capture-Id':row.requestId,'X-Photo-Notes-Edition':row.edition,'X-Photo-Notes-Account':row.account});
  // A follow-up or incident closed while the photo waited offline. Keep the photo as an ordinary PhotoNote.
  const LINK_FIELDS=['follow_up_occurrence_id','incident_id','incident_view'];
  const linked=payload=>!!payload&&LINK_FIELDS.some(k=>payload[k]);
  async function unlink(id){
    const row=await transaction('readonly',store=>store.get(id));if(!row)return null;
    for(const k of LINK_FIELDS)delete row.payload[k];
    await transaction('readwrite',store=>store.put(row));return row;
  }
  const permanent=status=>[400,401,403,409,413,422].includes(status);
  const draftKey=(account,edition)=>{if(!/^[a-f0-9]{64}$/.test(account)||!edition)throw Error('Sign in first');return account+':'+edition;};
  async function saveDraft(account,edition,draft){
    const row={key:draftKey(account,edition),...draft,photo:null};
    row.photoBytes=await draft.photo.arrayBuffer();row.photoType=draft.photo.type;row.photoName=draft.photo.name||'draft-photo.jpg';
    await transaction('readwrite',store=>store.put(row),'drafts');
  }
  async function readDraft(account,edition){const row=await transaction('readonly',store=>store.get(draftKey(account,edition)),'drafts');if(row)row.photo=new Blob([row.photoBytes],{type:row.photoType});return row;}
  const clearDraft=(account,edition)=>transaction('readwrite',store=>store.delete(draftKey(account,edition)),'drafts');
  return {saveDraft,readDraft,clearDraft,accountKey,create,all,list,photo,migrate,thumbnail,thumbnailBlob,addThumbnail,makeThumbnail,remove,eligible,headers,permanent,linked,unlink,LINK_FIELDS};
});

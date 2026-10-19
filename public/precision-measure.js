/* PhotoNotes Precision Measure: measure a pothole or patch from a photo with a measuring card beside it.
   1. Card settings (once): which card and its measured size.
   2. Live camera coaching: finds the card several times a second and reports angle, distance and placement.
      Takes the photo itself when everything is right (or on Take Photo once acceptable).
   3. The photo is corrected to a true overhead view from the card.
   4. The person traces the damage edge (or drags a saw-cut rectangle); length, width and area update live.
   5. Depth from a tape reading. 6. Optional field test against a tape measurement.
   Uses PhotoNotesMeasureEngine (geometry) and js-aruco2 (card detection). */
(()=>{
'use strict';
const E=window.PhotoNotesMeasureEngine;
const CARD_KEY='pn_measure_card_v1';
const CARDS=[{nominal:152.4,label:'6-inch printed card (Letter paper)',print:6},{nominal:203.2,label:'8-inch printed card (11 x 17 paper)',print:8},{nominal:304.8,label:'12-inch card (print shop)',print:12}];
const PHOTO_HFOV=69,VIDEO_HFOV=66;
let detector=null;
const getDetector=()=>detector||(detector=new window.AR.Detector({dictionaryName:E.CARD_DICTIONARY}));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function cardSettings(){try{const v=JSON.parse(localStorage.getItem(CARD_KEY)||'null');return v&&v.side_mm>50?v:null;}catch{return null;}}
function saveCard(v){try{localStorage.setItem(CARD_KEY,JSON.stringify(v));}catch{}}
const inches=mm=>mm/E.MM_PER_IN;
function feetInches(mm){const t=inches(mm);const ft=Math.floor(t/12),inch=t-ft*12;return ft?`${ft} ft ${inch.toFixed(1)} in`:`${inch.toFixed(1)} in`;}
const sqft=mm2=>mm2/(E.MM_PER_IN*E.MM_PER_IN)/E.SQIN_PER_SQFT;

let dlg=null,stream=null,loopTimer=0,orientation={beta:null,gamma:null},orientationListener=null;
function stopCamera(){clearTimeout(loopTimer);loopTimer=0;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}if(orientationListener){window.removeEventListener('deviceorientation',orientationListener);orientationListener=null;}}
function close(){stopCamera();if(dlg){dlg.remove();dlg=null;}document.body.style.overflow='';}
function shell(title){
 if(!dlg){dlg=document.createElement('div');dlg.className='pm-dialog';dlg.setAttribute('role','dialog');dlg.setAttribute('aria-modal','true');dlg.setAttribute('aria-labelledby','pmTitle');document.body.append(dlg);document.body.style.overflow='hidden';}
 dlg.innerHTML=`<style>
 .pm-dialog{position:fixed;inset:0;z-index:1400;background:#fff;color:#000;overflow:auto;text-align:left;font-family:Arial,Helvetica,sans-serif}
 .pm-dialog *{color:#000}.pm-wrap{max-width:900px;margin:0 auto;padding:12px 14px 40px}
 .pm-dialog h2{margin:4px 0 8px;font-size:22px}.pm-dialog .row{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
 .pm-dialog label{display:block;margin:10px 0 4px;font-weight:bold}.pm-dialog input,.pm-dialog select{font-size:17px;padding:8px;max-width:100%}
 .pm-cam{position:relative;background:#000;border-radius:10px;overflow:hidden}.pm-cam video{display:block;width:100%;height:auto}
 .pm-cam canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
 .pm-guide{font-size:20px;font-weight:bold;margin:10px 0;padding:10px;border:3px solid #000;border-radius:10px;background:#fff}
 .pm-guide.ready{background:#c8f7c5}.pm-guide.close{background:#fff3b0}.pm-guide.bad{background:#ffd6d6}
 .pm-level{position:absolute;right:10px;top:10px;width:84px;height:84px;border-radius:50%;background:rgba(255,255,255,.85);border:2px solid #000}
 .pm-level:before{content:"";position:absolute;left:30px;top:30px;width:22px;height:22px;border:2px solid #000;border-radius:50%}
 .pm-bubble{position:absolute;left:33px;top:33px;width:18px;height:18px;border-radius:50%;background:#1b7a3d;transition:transform .1s}
 .pm-readouts{display:flex;gap:16px;flex-wrap:wrap;font-weight:bold}
 .pm-stage{position:relative;overflow:auto;max-height:62vh;border:2px solid #000;border-radius:8px;touch-action:pan-x pan-y;background:#333}
 .pm-zoom{position:relative;transform-origin:0 0}.pm-zoom canvas{display:block;width:100%;height:auto}.pm-zoom svg{position:absolute;inset:0;width:100%;height:100%}
 .pm-zoom svg circle{touch-action:none;cursor:grab}.pm-readout{font-size:19px;font-weight:bold;margin:10px 0}
 .pm-tools button[aria-pressed="true"]{outline:3px solid #000}
 .pm-note{border:2px solid #000;border-radius:8px;padding:10px;margin:10px 0;background:#fff}
 </style><div class="pm-wrap"><h2 id="pmTitle">${esc(title)}</h2><div id="pmBody"></div></div>`;
 return dlg.querySelector('#pmBody');
}

// ---------- 1. card settings ----------
function renderCardSetup(opts,next){
 const body=shell('Measuring Card'),cur=cardSettings();
 const curPreset=cur?CARDS.find(c=>Math.abs(c.nominal-cur.nominal_mm)<0.1):CARDS[0];
 body.innerHTML=`<p>Precision Measure needs the PhotoNotes Measuring Card lying flat beside the pothole. Print one, glue it to stiff board, and tell PhotoNotes its size.</p>
 <p><a class="btn secondary" id="pmPrintCard" href="/measuring-card.html?size=${(curPreset||CARDS[0]).print}" target="_blank" rel="noopener">Print a Measuring Card</a></p>
 <label for="pmCardSize">Card</label><select id="pmCardSize">${CARDS.map(c=>`<option value="${c.nominal}" ${curPreset&&curPreset.nominal===c.nominal?'selected':''}>${c.label}</option>`).join('')}</select>
 <label for="pmCardMeasured">Measured side of the black square</label>
 <div class="row"><input id="pmCardMeasured" inputmode="decimal" value="${cur?(cur.unit==='mm'?cur.side_mm.toFixed(1):inches(cur.side_mm).toFixed(3)):(CARDS[0].nominal/E.MM_PER_IN).toFixed(3)}" aria-describedby="pmCardHelp"><select id="pmCardUnit" aria-label="Unit"><option value="in" ${cur&&cur.unit==='mm'?'':'selected'}>inches</option><option value="mm" ${cur&&cur.unit==='mm'?'selected':''}>mm</option></select></div>
 <p id="pmCardHelp">Measure one side of the black square with a ruler, to 1/32 inch or 1 mm if you can. Printers can shrink a page slightly; entering the measured size keeps measurements accurate.</p>
 ${opts.canValidate?`<label><input type="checkbox" id="pmValidate" ${opts.validate?'checked':''}> Field test: I will also measure each pothole with a tape and enter it</label>`:''}
 <div class="row"><button class="btn" id="pmCardSave" type="button">Save and Continue</button><button class="btn secondary" id="pmCardCancel" type="button">Cancel</button></div>`;
 const size=body.querySelector('#pmCardSize'),measured=body.querySelector('#pmCardMeasured'),unit=body.querySelector('#pmCardUnit');
 size.onchange=()=>{const c=CARDS.find(c=>String(c.nominal)===size.value);measured.value=unit.value==='mm'?c.nominal.toFixed(1):(c.nominal/E.MM_PER_IN).toFixed(3);body.querySelector('#pmPrintCard').href='/measuring-card.html?size='+c.print;};
 unit.onchange=()=>{const v=Number(measured.value);if(!Number.isFinite(v))return;measured.value=unit.value==='mm'?(v*E.MM_PER_IN).toFixed(1):(v/E.MM_PER_IN).toFixed(3);};
 body.querySelector('#pmCardCancel').onclick=()=>{close();opts.onCancel?.();};
 body.querySelector('#pmCardSave').onclick=()=>{
  const v=Number(String(measured.value).replace(',','.')),mm=unit.value==='mm'?v:v*E.MM_PER_IN,nominal=Number(size.value);
  if(!Number.isFinite(mm)||mm<nominal*0.9||mm>nominal*1.1){alertIn(body,'Enter the measured side of the black square. It should be close to the card size you chose.');return;}
  saveCard({nominal_mm:nominal,side_mm:mm,unit:unit.value});
  opts.validate=!!body.querySelector('#pmValidate')?.checked;next();
 };
}
function alertIn(body,text){let n=body.querySelector('.pm-note.alert');if(!n){n=document.createElement('p');n.className='pm-note alert';n.setAttribute('role','alert');body.prepend(n);}n.textContent=text;}

// ---------- 2. live camera coaching ----------
async function renderCamera(opts){
 const card=cardSettings(),body=shell('Precision Measure');
 body.innerHTML=`<div class="pm-cam"><video id="pmVideo" playsinline muted autoplay></video><canvas id="pmOverlay"></canvas><div class="pm-level" aria-hidden="true"><span class="pm-bubble" id="pmBubble"></span></div></div>
 <div class="pm-guide bad" id="pmGuide" role="status" aria-live="polite">Starting the camera...</div>
 <div class="pm-readouts"><span id="pmAngle">Angle: waiting</span><span id="pmDistance">Distance: waiting</span></div>
 <label><input type="checkbox" id="pmAuto" checked> Take the photo automatically when everything is right</label>
 <div class="row"><button class="btn" id="pmShoot" type="button" disabled>Take Photo</button><button class="btn secondary" id="pmCardSettings" type="button">Card Settings</button><button class="btn secondary" id="pmCancel" type="button">Cancel</button></div>
 <p>Lay the card flat on the pavement right beside the pothole. Hold the phone level, straight down, about waist to chest height, with the pothole and card in the middle of the picture. Use the normal camera, not the wide-angle lens.</p>`;
 body.querySelector('#pmCancel').onclick=()=>{close();opts.onCancel?.();};
 body.querySelector('#pmCardSettings').onclick=()=>{stopCamera();renderCardSetup(opts,()=>renderCamera(opts));};
 const video=body.querySelector('#pmVideo'),overlay=body.querySelector('#pmOverlay'),guide=body.querySelector('#pmGuide'),shoot=body.querySelector('#pmShoot');
 orientationListener=e=>{orientation={beta:e.beta,gamma:e.gamma};const b=body.querySelector('#pmBubble');if(b&&Number.isFinite(e.beta)&&Number.isFinite(e.gamma)){const cl=v=>Math.max(-22,Math.min(22,v));b.style.transform=`translate(${cl(e.gamma)*1.6}px,${cl(e.beta)*1.6}px)`;b.style.background=E.deviceTilt(e.beta,e.gamma)<=E.LIMITS.tiltBestDeg?'#1b7a3d':'#b3261e';}};
 window.addEventListener('deviceorientation',orientationListener);
 try{
  stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:4032},height:{ideal:3024}}});
 }catch(error){guide.textContent=error&&error.name==='NotAllowedError'?'Camera access was not allowed. Allow the camera for PhotoNotes in your browser or phone settings, then try again.':'The camera could not start. Close other apps using the camera, then try again.';return;}
 if(!dlg||!body.isConnected){stopCamera();return;}
 video.srcObject=stream;await video.play().catch(()=>{});
 const work=document.createElement('canvas'),wctx=work.getContext('2d',{willReadFrequently:true});
 let history=[],readySince=0,last=null,lastMessage='';
 const step=()=>{
  if(!dlg||!video.isConnected){stopCamera();return;}
  const vw=video.videoWidth,vh=video.videoHeight;
  if(!vw){loopTimer=setTimeout(step,150);return;}
  const aw=Math.min(960,vw),ah=Math.round(vh*aw/vw);work.width=aw;work.height=ah;wctx.drawImage(video,0,0,aw,ah);
  const data=wctx.getImageData(0,0,aw,ah).data;
  let corners=null;try{corners=E.detectCard(getDetector(),data,aw,ah,960);}catch{}
  let tilt=null;if(corners){const h=E.planeToImage(corners,card.side_mm);if(h)tilt=E.tiltDegrees(h.planeToImage,E.focalFromFov(aw,VIDEO_HFOV),aw/2,ah/2);}
  const phoneTilt=E.deviceTilt(orientation.beta,orientation.gamma);
  history.push(corners);if(history.length>3)history.shift();
  const steady=history.length===3&&history.every(Boolean)&&E.cornersMoved(history[0],history[2])<E.LIMITS.steadyPx*(aw/960)*2;
  const a=E.assessFrame({corners,width:aw,height:ah,tilt,phoneTilt,steady});last={a,tilt,phoneTilt,corners,aw,ah};
  // overlay
  const rect=video.getBoundingClientRect();overlay.width=Math.round(rect.width);overlay.height=Math.round(rect.height);const o=overlay.getContext('2d');o.clearRect(0,0,overlay.width,overlay.height);
  if(corners){const sx=overlay.width/aw,sy=overlay.height/ah;o.lineWidth=5;o.strokeStyle=a.ready?'#21c45d':a.capturable?'#ffd400':'#ff3b30';o.beginPath();corners.forEach((p,i)=>i?o.lineTo(p.x*sx,p.y*sy):o.moveTo(p.x*sx,p.y*sy));o.closePath();o.stroke();}
  if(a.message!==lastMessage){guide.textContent=a.message;lastMessage=a.message;}
  guide.className='pm-guide '+(a.ready?'ready':a.capturable?'close':'bad');
  const ang=a.tilt!=null&&corners?a.tilt:phoneTilt;
  body.querySelector('#pmAngle').textContent=ang==null?'Angle: waiting':`Angle: ${Math.round(ang)}° from straight down ${ang<=E.LIMITS.tiltBestDeg?'(good)':ang<=E.LIMITS.tiltMaxDeg?'(acceptable)':'(too steep)'}`;
  body.querySelector('#pmDistance').textContent=a.cardFraction==null?'Distance: card not found':`Distance: ${a.state==='too_far'?'too far':a.state==='too_close'?'too close':'good'}`;
  shoot.disabled=!a.capturable;
  if(a.ready){if(!readySince)readySince=Date.now();if(body.querySelector('#pmAuto').checked&&Date.now()-readySince>=700){take();return;}}else readySince=0;
  loopTimer=setTimeout(step,120);
 };
 const take=async()=>{
  if(!stream)return;clearTimeout(loopTimer);shoot.disabled=true;guide.textContent='Taking the photo. Hold still...';guide.className='pm-guide ready';
  const track=stream.getVideoTracks()[0];let blob=null;
  try{if('ImageCapture' in window){blob=await new window.ImageCapture(track).takePhoto();}}catch{blob=null;}
  if(!blob){const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;c.getContext('2d').drawImage(video,0,0);blob=await new Promise(r=>c.toBlob(r,'image/jpeg',0.93));}
  const info={phone_tilt_deg:last?.phoneTilt??null,live_tilt_deg:last?.tilt??null,live_card_fraction:last?.a?.cardFraction??null};
  stopCamera();
  if(!blob){renderProblem(opts,'The photo could not be taken. Try again.');return;}
  processPhoto(opts,new File([blob],'precision-measure.jpg',{type:blob.type||'image/jpeg'}),'live',info);
 };
 shoot.onclick=take;
 step();
}
function renderProblem(opts,text,file){
 const body=shell('Precision Measure');
 body.innerHTML=`<p class="pm-note" role="alert">${esc(text)}</p><div class="row">${opts.mode==='existing'?'':'<button class="btn" id="pmRetry" type="button">Take Another Photo</button>'}<button class="btn secondary" id="pmClose" type="button">Close</button></div>`;
 body.querySelector('#pmRetry')?.addEventListener('click',()=>renderCamera(opts));
 body.querySelector('#pmClose').onclick=()=>{close();opts.onCancel?.();};
}

// ---------- 3. overhead view ----------
async function loadPixels(file){
 const maxSide=4096;let bmp;
 try{bmp=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{bmp=await new Promise((res,rej)=>{const img=new Image();img.onload=()=>res(img);img.onerror=rej;img.src=URL.createObjectURL(file);});}
 const s=Math.min(1,maxSide/Math.max(bmp.width,bmp.height)),w=Math.round(bmp.width*s),h=Math.round(bmp.height*s);
 const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(bmp,0,0,w,h);
 return {canvas:c,data:ctx.getImageData(0,0,w,h).data,width:w,height:h};
}
async function processPhoto(opts,file,capture,info={}){
 const body=shell('Precision Measure'),card=cardSettings();
 body.innerHTML='<p class="pm-guide close" role="status">Finding the card and correcting the photo to an overhead view...</p>';
 await new Promise(r=>setTimeout(r,30));
 let px;try{px=await loadPixels(file);}catch{renderProblem(opts,'This photo could not be opened.');return;}
 let corners=null;try{corners=E.detectCard(getDetector(),px.data,px.width,px.height,1280);}catch{}
 if(!corners){renderProblem(opts,capture==='existing'?'No PhotoNotes Measuring Card was found in this photo. Precision Measure needs the card lying flat beside the damage.':'The card could not be found in the photo. Keep the whole card in view, flat and in good light, then try again.');return;}
 // Refine the corners on a crop around the card, at full resolution.
 const xs=corners.map(p=>p.x),ys=corners.map(p=>p.y),side=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)),m=Math.round(side*0.3);
 const x0=Math.max(0,Math.floor(Math.min(...xs))-m),y0=Math.max(0,Math.floor(Math.min(...ys))-m),x1=Math.min(px.width,Math.ceil(Math.max(...xs))+m),y1=Math.min(px.height,Math.ceil(Math.max(...ys))+m);
 const cw=x1-x0,ch=y1-y0,crop=new Uint8ClampedArray(cw*ch*4);
 for(let y=0;y<ch;y++)crop.set(px.data.subarray(((y+y0)*px.width+x0)*4,((y+y0)*px.width+x0+cw)*4),y*cw*4);
 const ref=E.refineCorners(E.grayFrom(crop,cw,ch),cw,ch,corners.map(p=>({x:p.x-x0,y:p.y-y0})));
 corners=ref.corners.map(p=>({x:p.x+x0,y:p.y+y0}));
 const homs=E.planeToImage(corners,card.side_mm);
 if(!homs){renderProblem(opts,'The card was found but its shape could not be read. Try again with the whole card in view.');return;}
 const tilt=E.tiltDegrees(homs.planeToImage,E.focalFromFov(px.width,PHOTO_HFOV),px.width/2,px.height/2);
 if(tilt>E.LIMITS.tiltMaxDeg+2){renderProblem(opts,`The photo was taken at about ${Math.round(tilt)}° from straight down. Precision Measure needs 15° or less. Hold the phone flatter and try again.`);return;}
 const fraction=E.cardFraction(corners,px.width,px.height);
 const plan=E.planRectify(homs.planeToImage,px.width,px.height,card.side_mm,corners,{maxPixels:6e6,reachMm:1800});
 const out=document.createElement('canvas');out.width=plan.width;out.height=plan.height;const octx=out.getContext('2d');const img=octx.createImageData(plan.width,plan.height);
 for(let y=0;y<plan.height;y+=96){E.warpRows(px.data,px.width,px.height,plan.outputToImage,img.data,plan.width,y,Math.min(plan.height,y+96));if(y%384===0)await new Promise(r=>setTimeout(r));}
 octx.putImageData(img,0,0);
 const session={file,capture,card,tilt,fraction,refined:ref.refined,plan,overhead:out,info,points:[],mode:'outline',edges:'clean'};
 if(tilt>E.LIMITS.tiltMaxDeg)session.warning=`Taken at about ${Math.round(tilt)}°. Measurements are less accurate above 15°.`;
 renderOutline(opts,session);
}

// ---------- 4. outline ----------
function renderOutline(opts,s){
 window.PhotoNotesPrecisionMeasure._session=s; // read by the automated accuracy test
 const body=shell('Trace the Damage');
 body.innerHTML=`<p>This is the photo corrected to a straight-down view. ${s.mode==='rect'?'Drag the four corners to the edges of the patch you would cut.':'Tap along the edge of the damage to outline it. Drag a point to adjust it.'} Zoom in for accuracy.</p>
 ${s.warning?`<p class="pm-note">${esc(s.warning)}</p>`:''}
 <div class="row pm-tools"><button class="btn secondary slim" type="button" data-pm-mode="outline" aria-pressed="${s.mode==='outline'}">Trace Outline</button><button class="btn secondary slim" type="button" data-pm-mode="rect" aria-pressed="${s.mode==='rect'}">Saw-Cut Rectangle</button><button class="btn secondary slim" type="button" id="pmZoomOut" aria-label="Zoom out">Zoom Out</button><button class="btn secondary slim" type="button" id="pmZoomIn" aria-label="Zoom in">Zoom In</button><button class="btn secondary slim" type="button" id="pmUndo">Undo Point</button><button class="btn secondary slim" type="button" id="pmClear">Clear</button></div>
 <div class="pm-stage" id="pmStage"><div class="pm-zoom" id="pmZoom"></div></div>
 <p class="pm-readout" id="pmReadout" role="status" aria-live="polite"></p>
 <label for="pmEdges">Edges of the damage</label><select id="pmEdges"><option value="clean" ${s.edges==='clean'?'selected':''}>Clean or saw-cut edges</option><option value="ragged" ${s.edges==='ragged'?'selected':''}>Ragged, crumbling edges</option></select>
 <div class="row"><button class="btn" id="pmOutlineDone" type="button">Continue</button><button class="btn secondary" id="pmRetake" type="button">${s.capture==='existing'?'Cancel':'Retake Photo'}</button></div>`;
 const zoomBox=body.querySelector('#pmZoom'),stage=body.querySelector('#pmStage');
 zoomBox.append(s.overhead);
 const svgNS='http://www.w3.org/2000/svg',svg=document.createElementNS(svgNS,'svg');svg.setAttribute('viewBox',`0 0 ${s.plan.width} ${s.plan.height}`);svg.setAttribute('preserveAspectRatio','none');zoomBox.append(svg);
 let zoom=s.zoom||1;const applyZoom=()=>{zoomBox.style.width=(100*zoom)+'%';s.zoom=zoom;};applyZoom();
 // Start the view on the card.
 setTimeout(()=>{const c=E.planeToOverhead(s.plan,s.card.side_mm/2,s.card.side_mm/2),r=zoomBox.getBoundingClientRect(),k=r.width/s.plan.width;stage.scrollLeft=Math.max(0,c.x*k-stage.clientWidth/2);stage.scrollTop=Math.max(0,c.y*k-stage.clientHeight/2);},0);
 body.querySelector('#pmZoomIn').onclick=()=>{zoom=Math.min(8,zoom*1.5);applyZoom();draw();};
 body.querySelector('#pmZoomOut').onclick=()=>{zoom=Math.max(1,zoom/1.5);applyZoom();draw();};
 body.querySelectorAll('[data-pm-mode]').forEach(b=>b.onclick=()=>{s.mode=b.dataset.pmMode;if(s.mode==='rect'&&s.points.length!==4){const cx=s.card.side_mm+300,cy=s.card.side_mm/2,hw=250,hh=180;s.points=[{x:cx-hw,y:cy-hh},{x:cx+hw,y:cy-hh},{x:cx+hw,y:cy+hh},{x:cx-hw,y:cy+hh}];}renderOutline(opts,s);});
 body.querySelector('#pmUndo').onclick=()=>{if(s.mode==='outline'){s.points.pop();draw();}};
 body.querySelector('#pmClear').onclick=()=>{s.points=[];if(s.mode==='rect')s.mode='outline';renderOutline(opts,s);};
 body.querySelector('#pmEdges').onchange=e=>{s.edges=e.target.value;};
 body.querySelector('#pmRetake').onclick=()=>{if(s.capture==='existing'){close();opts.onCancel?.();}else renderCamera(opts);};
 const toPlane=e=>{const r=svg.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*s.plan.width,y=(e.clientY-r.top)/r.height*s.plan.height;return E.overheadToPlane(s.plan,x,y);};
 const radius=()=>{const r=svg.getBoundingClientRect();return 9*s.plan.width/Math.max(1,r.width);};
 function draw(){
  svg.innerHTML='';const pts=s.points.map(p=>E.planeToOverhead(s.plan,p.x,p.y)),rad=radius();
  // the card outline, so the person can see what the scale comes from
  const cardPts=E.cardPlanePoints(s.card.side_mm).map(p=>E.planeToOverhead(s.plan,p.x,p.y));
  const cp=document.createElementNS(svgNS,'polygon');cp.setAttribute('points',cardPts.map(p=>`${p.x},${p.y}`).join(' '));cp.setAttribute('fill','none');cp.setAttribute('stroke','#21c45d');cp.setAttribute('stroke-width',rad*0.4);svg.append(cp);
  if(pts.length>1){const poly=document.createElementNS(svgNS,pts.length>2?'polygon':'polyline');poly.setAttribute('points',pts.map(p=>`${p.x},${p.y}`).join(' '));poly.setAttribute('fill','rgba(255,212,0,.25)');poly.setAttribute('stroke','#ffd400');poly.setAttribute('stroke-width',rad*0.45);svg.append(poly);}
  pts.forEach((p,i)=>{const c=document.createElementNS(svgNS,'circle');c.setAttribute('cx',p.x);c.setAttribute('cy',p.y);c.setAttribute('r',rad);c.setAttribute('fill','#fff');c.setAttribute('stroke','#000');c.setAttribute('stroke-width',rad*0.3);c.dataset.i=i;c.addEventListener('pointerdown',ev=>{ev.preventDefault();ev.stopPropagation();c.setPointerCapture(ev.pointerId);const move=e2=>{s.points[i]=toPlane(e2);draw();};const up=()=>{c.removeEventListener('pointermove',move);c.removeEventListener('pointerup',up);c.removeEventListener('pointercancel',up);};c.addEventListener('pointermove',move);c.addEventListener('pointerup',up);c.addEventListener('pointercancel',up);});svg.append(c);});
  const m=s.points.length>=3?E.measureOutline(s.points):null;s.result=m;
  body.querySelector('#pmReadout').textContent=m?`Length ${feetInches(m.lengthMm)} × Width ${feetInches(m.widthMm)} · Area ${(s.mode==='rect'?sqft(m.areaMm2):sqft(m.areaMm2)).toFixed(2)} sq ft${s.mode==='outline'?` (saw-cut rectangle around it: ${sqft(m.rectAreaMm2).toFixed(2)} sq ft)`:''}`:s.mode==='outline'?'Tap at least three points along the edge.':'';
 }
 // A short tap adds a point; a drag scrolls the view.
 let down=null;
 svg.addEventListener('pointerdown',e=>{if(e.target.tagName==='circle')return;down={x:e.clientX,y:e.clientY,t:Date.now()};});
 svg.addEventListener('pointercancel',()=>{down=null;});
 svg.addEventListener('pointerup',e=>{if(!down||s.mode!=='outline')return;const moved=Math.hypot(e.clientX-down.x,e.clientY-down.y),slow=Date.now()-down.t;down=null;if(moved<8&&slow<600){s.points.push(toPlane(e));draw();}});
 draw();
 body.querySelector('#pmOutlineDone').onclick=()=>{if(!s.result){alertIn(body,'Outline the damage with at least three points first.');return;}renderDepth(opts,s);};
}

// ---------- 5. depth ----------
function renderDepth(opts,s){
 const body=shell('Depth');
 body.innerHTML=`<p>A photo cannot measure depth. Lay a straightedge across the pothole, stand a tape at the deepest point, and read the tape where it meets the straightedge.</p>
 <label for="pmDepth">Deepest point, in inches</label><input id="pmDepth" type="number" step="0.125" min="0" max="24" inputmode="decimal" value="${s.depthIn??''}">
 <div class="row"><button class="btn" id="pmDepthDone" type="button">Use This Depth</button><button class="btn secondary" id="pmDepthSkip" type="button">Depth Not Measured</button><button class="btn secondary" id="pmBack" type="button">Back to Outline</button></div>`;
 body.querySelector('#pmBack').onclick=()=>renderOutline(opts,s);
 body.querySelector('#pmDepthSkip').onclick=()=>{s.depthIn=null;afterDepth(opts,s);};
 body.querySelector('#pmDepthDone').onclick=()=>{const v=Number(String(body.querySelector('#pmDepth').value).replace(',','.'));if(!Number.isFinite(v)||v<=0||v>24){alertIn(body,'Enter the depth in inches, for example 2.5, or choose Depth Not Measured.');return;}s.depthIn=Math.round(v*8)/8;afterDepth(opts,s);};
}
function afterDepth(opts,s){if(opts.validate)renderValidation(opts,s);else finish(opts,s);}

// ---------- 6. field test ----------
function renderValidation(opts,s){
 const body=shell('Field Test');
 const m=s.result;
 body.innerHTML=`<p>Measure the same pothole with a tape the way you would mark a saw-cut patch: the longest side, then the width across it. Enter what the tape shows. PhotoNotes records both so the real accuracy can be reported.</p>
 <p class="pm-note">PhotoNotes measured: length ${(inches(m.lengthMm)).toFixed(2)} in, width ${(inches(m.widthMm)).toFixed(2)} in. Measure with the tape before looking at these numbers if you can.</p>
 <label for="pmTapeL">Tape length, inches</label><input id="pmTapeL" type="number" step="0.0625" inputmode="decimal">
 <label for="pmTapeW">Tape width, inches</label><input id="pmTapeW" type="number" step="0.0625" inputmode="decimal">
 <label for="pmTapeD">Tape depth at the deepest point, inches (optional)</label><input id="pmTapeD" type="number" step="0.0625" inputmode="decimal">
 <label for="pmTapeNote">Notes (optional)</label><input id="pmTapeNote" maxlength="300" placeholder="Example: sunny, wet edges">
 <div class="row"><button class="btn" id="pmTapeSave" type="button">Save Field Test</button><button class="btn secondary" id="pmTapeSkip" type="button">Skip</button></div>`;
 body.querySelector('#pmTapeSkip').onclick=()=>finish(opts,s);
 body.querySelector('#pmTapeSave').onclick=async()=>{
  const n=id=>{const v=Number(String(body.querySelector(id).value).replace(',','.'));return Number.isFinite(v)&&v>0?v:null;};
  const L=n('#pmTapeL'),W=n('#pmTapeW'),D=n('#pmTapeD');if(!L||!W){alertIn(body,'Enter the tape length and width.');return;}
  const btn=body.querySelector('#pmTapeSave');btn.disabled=true;
  try{const r=await fetch('/api/precision-measure/validation',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({app:{length_mm:m.lengthMm,width_mm:m.widthMm,area_mm2:m.areaMm2,depth_in:s.depthIn},tape:{length_mm:L*E.MM_PER_IN,width_mm:W*E.MM_PER_IN,depth_in:D},card_mm:s.card.side_mm,tilt_deg:s.tilt,phone_tilt_deg:s.info.phone_tilt_deg,card_fraction:s.fraction,px_per_mm:s.plan.pxPerMm,mode:s.mode==='rect'?'rectangle':'outline',edges:s.edges,capture:s.capture,note:body.querySelector('#pmTapeNote').value})});
   const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'The field test could not be saved.');
   s.validation={length_accuracy:d.length_accuracy,width_accuracy:d.width_accuracy};
   const note=document.createElement('p');note.className='pm-note';note.setAttribute('role','status');note.textContent=`Saved. Accuracy against the tape: length ${d.length_accuracy.toFixed(1)}%, width ${d.width_accuracy.toFixed(1)}%.`;body.prepend(note);
   btn.textContent='Continue';btn.disabled=false;btn.onclick=()=>finish(opts,s);
  }catch(e){btn.disabled=false;alertIn(body,e.message);}
 };
}

// ---------- done ----------
function finish(opts,s){
 const m=s.result,rectMode=s.mode==='rect';
 const dims={length_in:inches(m.lengthMm),width_in:inches(m.widthMm),depth_in:s.depthIn??null,area_sqft:sqft(m.areaMm2),shape:rectMode?'rectangle':'irregular'};
 const record={method:'card',card_mm:Math.round(s.card.side_mm*100)/100,tilt_deg:Math.round(s.tilt*10)/10,phone_tilt_deg:s.info.phone_tilt_deg==null?null:Math.round(s.info.phone_tilt_deg*10)/10,card_fraction:Math.round(s.fraction*1000)/1000,refined:s.refined,px_per_mm:Math.round(s.plan.pxPerMm*1000)/1000,mode:rectMode?'rectangle':'outline',edges:s.edges,outline_mm:s.points.map(p=>[Math.round(p.x*10)/10,Math.round(p.y*10)/10]),saw_cut_area_sqft:Math.round(sqft(m.rectAreaMm2)*100)/100,capture:s.capture,validation:s.validation||null};
 close();opts.onDone?.({file:s.file,dims,record});
}

// ---------- entry points ----------
// open({mode:'live'|'existing', file, canValidate, onDone({file,dims,record}), onCancel})
function open(opts={}){
 // iPhone asks once for motion access; the request must happen on the tap that opened Precision Measure.
 try{if(opts.mode!=='existing'&&typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function')DeviceOrientationEvent.requestPermission().catch(()=>{});}catch{}
 if(!window.AR||!E){const body=shell('Precision Measure');body.innerHTML='<p class="pm-note" role="alert">Precision Measure could not load. Reload PhotoNotes and try again.</p><button class="btn" id="pmClose" type="button">Close</button>';body.querySelector('#pmClose').onclick=()=>{close();opts.onCancel?.();};return;}
 const start=()=>opts.mode==='existing'?processPhoto(opts,opts.file,'existing',{}):renderCamera(opts);
 if(!cardSettings())renderCardSetup(opts,start);else start();
}
const supported=()=>!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia);
window.PhotoNotesPrecisionMeasure={open,supported,cardSettings,close};
})();

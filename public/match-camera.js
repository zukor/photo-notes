/* Optional live preview. Native camera remains the default and fallback. */
(() => {
  let current=null;
  const stop=()=>{if(!current)return;current.cancelled=true;current.stream?.getTracks().forEach(t=>t.stop());current.modal.remove();current=null;};
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  window.addEventListener('pagehide',stop);
  window.PhotoNotesMatchCamera={
    available:()=>window.isSecureContext&&!!navigator.mediaDevices?.getUserMedia&&!(/iPad|iPhone|iPod/.test(navigator.userAgent)||(/Macintosh/.test(navigator.userAgent)&&navigator.maxTouchPoints>1)),
    stop,
    async open(reference,onCapture,onFallback){
      stop();const modal=document.createElement('div');modal.className='comparison-dialog';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Match Camera');
      modal.innerHTML=`<section><strong>Match Camera</strong><p>Match camera height, direction, horizon and landmarks. Keep the same device orientation as the reference.</p><p id="matchCameraStatus" role="status">Allow camera access to start preview.</p><div style="position:relative;background:#000"><video id="matchVideo" autoplay muted playsinline style="display:block;width:100%;max-height:65vh;object-fit:contain"></video><img id="matchGhost" alt="Reference guide" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:.5;pointer-events:none"></div><label for="matchCameraOpacity">Reference Opacity</label><input id="matchCameraOpacity" type="range" min="0" max="100" value="50"><label for="matchCameraFacing">Camera</label><select id="matchCameraFacing"><option value="environment">Rear Camera</option><option value="user">Front Camera</option></select><div class="row"><button class="btn" id="matchCameraCapture" disabled>Capture Matching Photo</button><button class="btn secondary" id="matchCameraNative">Use Native Camera</button><button class="btn secondary" id="matchCameraClose">Cancel</button></div></section>`;
      document.body.appendChild(modal);const session={modal,cancelled:false,stream:null,generation:0};current=session;
      const video=modal.querySelector('#matchVideo'),capture=modal.querySelector('#matchCameraCapture'),status=modal.querySelector('#matchCameraStatus');modal.querySelector('#matchGhost').src=reference;
      const fallback=(native=false)=>{stop();onFallback(native);};modal.querySelector('#matchCameraNative').onclick=()=>fallback(true);modal.querySelector('#matchCameraClose').onclick=stop;
      modal.querySelector('#matchCameraOpacity').oninput=e=>modal.querySelector('#matchGhost').style.opacity=Number(e.target.value)/100;
      async function start(){
        const generation=++session.generation;session.stream?.getTracks().forEach(t=>t.stop());capture.disabled=true;status.textContent='Starting camera...';
        try{
          // Stop first when changing cameras. Never request audio or require a particular resolution.
          const pending=navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:modal.querySelector('#matchCameraFacing').value},width:{ideal:1920},height:{ideal:1080}}});
          pending.then(s=>{if(session.cancelled||generation!==session.generation)s.getTracks().forEach(t=>t.stop());}).catch(()=>{});
          let timer;const stream=await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Camera timeout')),15000);})]).finally(()=>clearTimeout(timer));
          pending.then(s=>{if(session.cancelled||generation!==session.generation)s.getTracks().forEach(t=>t.stop());}).catch(()=>{});
          if(session.cancelled||generation!==session.generation){stream.getTracks().forEach(t=>t.stop());return;}
          session.stream=stream;video.srcObject=stream;await video.play();
          await new Promise((resolve,reject)=>{if(video.readyState>=2&&video.videoWidth)return resolve();const timeout=setTimeout(()=>reject(Error('Preview unavailable')),5000);video.addEventListener('loadeddata',()=>{clearTimeout(timeout);resolve();},{once:true});});
          if(session.cancelled||generation!==session.generation)return;
          if(!video.videoWidth||!video.videoHeight)throw Error('Preview unavailable');
          capture.disabled=false;status.textContent='Reference guide over live camera. Align landmarks, then capture.';
          const track=stream.getVideoTracks()[0];track.addEventListener('ended',()=>{if(!session.cancelled)fallback();},{once:true});track.addEventListener('mute',()=>{capture.disabled=true;status.textContent='Camera paused. Use Native Camera if preview does not resume.';});track.addEventListener('unmute',()=>{capture.disabled=false;});
        }catch(e){if(generation!==session.generation)return;session.cancelled=true;pendingCleanup();if(current===session){stop();onFallback(false);}}
        function pendingCleanup(){session.stream?.getTracks().forEach(t=>t.stop());}
      }
      modal.querySelector('#matchCameraFacing').onchange=start;
      capture.onclick=async()=>{
        capture.disabled=true;
        try{if(video.readyState<2||!video.videoWidth)throw Error('Camera unavailable');const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.92));if(!blob)throw Error('Capture unavailable');const file=new File([blob],'matching-photo.jpg',{type:'image/jpeg'});stop();onCapture(file);}catch(e){fallback();}
      };
      await start();
    }
  };
})();

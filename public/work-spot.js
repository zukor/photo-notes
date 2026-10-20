// Work link page for the person doing the work: the problem, its photo, a map pin back to where the photo was taken,
// directions, live distance and direction on site, Match the Photo, and completion photos with their location.
(function (root) {
  'use strict';
  const FT_PER_M = 3.280839895;
  function distanceBearing(a, b) {
    const rad = x => x * Math.PI / 180, dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const v = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    const meters = 6371000 * 2 * Math.atan2(Math.sqrt(v), Math.sqrt(Math.max(0, 1 - v)));
    const bearing = (Math.atan2(Math.sin(dLng) * Math.cos(rad(b.lat)), Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLng)) * 180 / Math.PI + 360) % 360;
    return { meters, feet: meters * FT_PER_M, bearing };
  }
  const NAMES = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  const compassName = deg => NAMES[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  function formatDistance(feet) {
    if (!Number.isFinite(feet)) return '';
    if (feet >= 1000) return (feet / 5280).toFixed(feet >= 52800 ? 0 : 1) + ' miles';
    return Math.round(feet / (feet >= 100 ? 10 : 1)) * (feet >= 100 ? 10 : 1) + ' ft';
  }
  // Close enough to call it the spot: the photo's GPS uncertainty plus the phone's, at least 25 ft.
  function arrivedFeet(targetAccM, hereAccM) { return Math.max(25, ((Number(targetAccM) || 0) + (Number(hereAccM) || 0)) * FT_PER_M * 0.75); }
  function directionsUrl(target, address, ua) {
    const apple = /iPhone|iPad|Macintosh/.test(ua || '');
    if (target) return apple ? `https://maps.apple.com/?daddr=${target.lat},${target.lng}&dirflg=d` : `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}`;
    if (address) return apple ? `https://maps.apple.com/?daddr=${encodeURIComponent(address)}` : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
    return null;
  }
  const helpers = { distanceBearing, compassName, formatDistance, arrivedFeet, directionsUrl };
  if (typeof module === 'object' && module.exports) { module.exports = helpers; return; }
  root.PhotoNotesWorkSpot = helpers;

  const $ = id => document.getElementById(id);
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  let data, map, youMarker, youCircle, watch = null, here = null, heading = null, files = [], stream = null;

  function render() {
    const d = data, it = d.item;
    document.title = 'Work Order: ' + it.title;
    $('wsTitle').textContent = it.title;
    const pr = { emergency: 'Emergency', high: 'High', routine: 'Routine', monitor: 'Monitor' }[it.priority] || '';
    $('wsDetails').innerHTML = `<p class="ws-meta"><strong>${esc(d.property.name)}</strong>${d.property.area ? ', ' + esc(d.property.area) : ''}</p>`
      + (d.property.address ? `<p class="ws-meta">${esc(d.property.address)}</p>` : '')
      + (it.category ? `<p class="ws-meta">Category: ${esc(it.category)}</p>` : '')
      + (pr ? `<p class="ws-meta">Priority: ${esc(pr)}</p>` : '')
      + (it.target_date ? `<p class="ws-meta">Needed by: ${esc(new Date(it.target_date + 'T12:00:00').toLocaleDateString())}</p>` : '')
      + (it.description ? `<p>${esc(it.description)}</p>` : '')
      + (d.instructions ? `<p><strong>Instructions:</strong> ${esc(d.instructions)}</p>` : '')
      + (d.recipient_name ? `<p class="ws-meta">Sent to: ${esc(d.recipient_name)}</p>` : '');
    const photos = d.photos || [];
    if (photos.length) { $('wsMainPhoto').src = photos[0].url; $('wsMainPhoto').alt = 'Photo of the problem' + (photos[0].note ? ': ' + photos[0].note : ''); }
    else { $('wsMainPhoto').hidden = true; $('wsMatchOpen').hidden = true; }
    $('wsThumbs').innerHTML = photos.length > 1 ? photos.map((p, i) => `<button type="button" data-ws-photo="${i}" aria-label="Show photo ${i + 1}"><img src="${esc(p.url)}" alt=""></button>`).join('') : '';
    document.querySelectorAll('[data-ws-photo]').forEach(b => b.onclick = () => { const p = photos[Number(b.dataset.wsPhoto)]; $('wsMainPhoto').src = p.url; $('wsMatchGhost').src = p.url; });
    if (photos.length) $('wsMatchGhost').src = photos[0].url;
    const t = d.target;
    const facing = d.camera_direction != null ? ` The photo was taken facing ${compassName(d.camera_direction)}.` : '';
    $('wsWhere').textContent = t
      ? (t.source === 'marked' ? 'The pin marks the problem.' : `The pin is where the photo was taken${t.accuracy_m ? `, accurate to about ${formatDistance(t.accuracy_m * FT_PER_M)}` : ''}.`) + facing + (d.location_description ? ' ' + d.location_description : '')
      : (d.indoor ? 'This photo has no GPS location. Use the address for directions, then the indoor location below.' : 'This photo has no saved location. Use the address and the photo to find the problem.');
    if (d.indoor && (d.indoor.text || d.indoor.plan_url)) {
      $('wsIndoor').hidden = false; $('wsIndoorText').textContent = d.indoor.text || 'See the floor plan';
      if (d.indoor.plan_url) {
        $('wsPlanWrap').hidden = false; $('wsPlanImg').src = d.indoor.plan_url; $('wsPlanLabel').textContent = 'Floor plan: ' + (d.indoor.plan_label || '') + (d.indoor.x != null ? '. The yellow dot is where the photo was taken.' : '');
        if (d.indoor.x != null) { const pin = $('wsPlanPin'); pin.hidden = false; pin.style.left = (d.indoor.x * 100) + '%'; pin.style.top = (d.indoor.y * 100) + '%'; }
      }
    }
    const dir = directionsUrl(t, d.property.address, navigator.userAgent);
    if (dir) $('wsDirections').href = dir; else $('wsDirections').hidden = true;
    if (!t) { $('wsFind').hidden = true; $('wsMap').hidden = true; $('wsLayer').hidden = true; }
    $('wsContent').hidden = false; $('wsStatus').textContent = '';
    if (t) drawMap();
  }
  function drawMap() {
    if (!root.L) { $('wsMap').textContent = 'The map could not load. Get Directions and Find the Spot still work.'; return; }
    const t = data.target;
    map = L.map('wsMap', { zoomControl: true }).setView([t.lat, t.lng], 19);
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 21, maxNativeZoom: 19, attribution: 'Imagery © Esri' });
    const street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 21, maxNativeZoom: 19, attribution: '© OpenStreetMap contributors' });
    let onSat = true; sat.addTo(map);
    $('wsLayer').onclick = () => { if (onSat) { map.removeLayer(sat); street.addTo(map); $('wsLayer').textContent = 'Show Satellite'; } else { map.removeLayer(street); sat.addTo(map); $('wsLayer').textContent = 'Show Street Map'; } onSat = !onSat; };
    L.marker([t.lat, t.lng], { title: 'Photo spot', alt: 'Photo spot' }).addTo(map).bindPopup(esc(data.item.title));
    if (t.accuracy_m) L.circle([t.lat, t.lng], { radius: t.accuracy_m, color: '#000', weight: 2, fillColor: '#ffd400', fillOpacity: 0.15 }).addTo(map);
  }
  function updateGuide() {
    const t = data.target; if (!t || !here) return;
    const d = distanceBearing(here, t), close = d.feet <= arrivedFeet(t.accuracy_m, here.accuracy);
    $('wsDistance').textContent = close ? 'You are at the spot' : `${formatDistance(d.feet)} away`;
    $('wsDirectionText').textContent = close ? 'Look around for what is in the photo, or use Match the Photo.' : `Head ${compassName(d.bearing)}.` + (heading == null ? '' : ' Follow the arrow.');
    $('wsGuideNote').textContent = here.accuracy ? `Your phone's location is accurate to about ${formatDistance(here.accuracy * FT_PER_M)}.` : '';
    const rot = heading == null ? d.bearing : d.bearing - heading;
    $('wsArrow').style.transform = close ? 'none' : `rotate(${rot}deg)`;
    if (map) {
      const ll = [here.lat, here.lng];
      if (!youMarker) { youMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="ws-you"></div>', iconSize: [0, 0] }), title: 'You', alt: 'You' }).addTo(map); youCircle = L.circle(ll, { radius: here.accuracy || 0, color: '#1565ff', weight: 1, fillOpacity: 0.08 }).addTo(map); map.fitBounds(L.latLngBounds([ll, [t.lat, t.lng]]).pad(0.3), { maxZoom: 19 }); }
      else { youMarker.setLatLng(ll); youCircle.setLatLng(ll).setRadius(here.accuracy || 0); }
    }
  }
  function startFind() {
    if (!navigator.geolocation) { $('wsGuideBox').hidden = false; $('wsDistance').textContent = 'Location is not available on this phone.'; return; }
    $('wsGuideBox').hidden = false; $('wsDistance').textContent = 'Finding your location...'; $('wsDirectionText').textContent = '';
    if (watch !== null) navigator.geolocation.clearWatch(watch);
    watch = navigator.geolocation.watchPosition(p => { here = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }; updateGuide(); },
      e => { $('wsDistance').textContent = e && e.code === 1 ? 'Location is turned off for this page.' : 'Your location could not be found.'; $('wsDirectionText').textContent = e && e.code === 1 ? 'Allow location for this website in your phone settings, then tap Find the Spot again.' : 'Step outside or wait a moment, then tap Find the Spot again.'; },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  }
  function onOrientation(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360;
    if (h != null) { heading = h; updateGuide(); }
  }
  async function compassOn() {
    try {
      if (root.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') { const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') throw Error('denied'); }
      root.addEventListener('deviceorientationabsolute', onOrientation); root.addEventListener('deviceorientation', onOrientation);
      $('wsCompass').hidden = true; $('wsGuideNote').textContent = 'Hold the phone flat. The arrow points toward the spot.';
    } catch (e) { $('wsGuideNote').textContent = 'The compass is not available. Use the direction shown above.'; }
  }
  function stopFind() { if (watch !== null) navigator.geolocation.clearWatch(watch); watch = null; $('wsGuideBox').hidden = true; root.removeEventListener('deviceorientationabsolute', onOrientation); root.removeEventListener('deviceorientation', onOrientation); }

  // ---- Completion photos ----
  async function addFile(file, loc) {
    if (files.length >= 8) { $('wsSubmitStatus').textContent = 'Send at most 8 photos at a time.'; return; }
    let where = loc || null;
    if (!where && root.PhotoNotesPhotoLocation) where = await PhotoNotesPhotoLocation.read(file).catch(() => null);
    if (!where && here && Date.now() - Number(file.lastModified || 0) < 180000) where = { lat: here.lat, lng: here.lng, accuracy: here.accuracy };
    files.push({ file, loc: where ? { lat: where.lat, lng: where.lng, accuracy: where.accuracy == null ? null : Math.round(where.accuracy * 10) / 10 } : null, url: URL.createObjectURL(file) });
    drawFiles();
  }
  function drawFiles() {
    $('wsFiles').innerHTML = files.map((f, i) => `<figure><img src="${f.url}" alt="Completion photo ${i + 1}"><figcaption>${f.loc ? 'Location saved' : 'No location'}</figcaption><button type="button" data-ws-remove="${i}">Remove</button></figure>`).join('');
    document.querySelectorAll('[data-ws-remove]').forEach(b => b.onclick = () => { const f = files.splice(Number(b.dataset.wsRemove), 1)[0]; if (f) URL.revokeObjectURL(f.url); drawFiles(); });
  }
  async function submit() {
    if (!files.length) { $('wsSubmitStatus').textContent = 'Add at least one photo of the finished work.'; return; }
    const btn = $('wsSubmit'); btn.disabled = true; $('wsSubmitStatus').textContent = 'Sending photos...';
    const fd = new FormData();
    fd.append('submitter_name', $('wsName').value.trim()); fd.append('note', $('wsNote').value.trim());
    fd.append('photo_locations', JSON.stringify(files.map(f => f.loc)));
    files.forEach((f, i) => fd.append('photos', f.file, f.file.name || `completion-${i + 1}.jpg`));
    try {
      const r = await fetch('/completion-photos/' + encodeURIComponent(token), { method: 'POST', body: fd, headers: { Accept: 'application/json' } });
      if (!r.ok) throw Error((await r.text()).replace(/<[^>]+>/g, '').trim() || 'Photos could not be sent.');
      stopFind();
      $('wsContent').innerHTML = '<div class="ws-box"><h2>Photos Received</h2><p>Thank you. The completion photos were added to the work order, and the property manager has been notified.</p></div>';
      root.scrollTo(0, 0);
    } catch (e) { $('wsSubmitStatus').textContent = e.message; btn.disabled = false; }
  }

  // ---- Match the Photo ----
  async function matchOpen() {
    $('wsMatch').classList.add('open');
    $('wsMatchGhost').style.opacity = $('wsMatchFade').value / 100;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false }); $('wsMatchVideo').srcObject = stream; }
    catch (e) { matchClose(); $('wsSubmitStatus').textContent = ''; $('wsGuideBox').hidden = false; $('wsGuideNote').textContent = 'The camera could not open. Allow camera access for this website, or compare the photo by eye.'; return; }
    if (watch === null && data.target) startFind();
    $('wsMatchClose').focus();
  }
  function matchClose() { $('wsMatch').classList.remove('open'); if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; $('wsMatchOpen').focus(); }
  function matchShoot() {
    const v = $('wsMatchVideo'); if (!v.videoWidth) return;
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob(b => { if (!b) return; addFile(new File([b], `completion-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }), here ? { lat: here.lat, lng: here.lng, accuracy: here.accuracy } : null); $('wsMatchShoot').textContent = `Photo Added (${files.length})`; setTimeout(() => { $('wsMatchShoot').textContent = 'Take Completion Photo'; }, 1500); }, 'image/jpeg', 0.9);
  }

  async function load() {
    try {
      const r = await fetch('/api/public/work-spot/' + encodeURIComponent(token), { headers: { Accept: 'application/json' } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(d.error || 'This work order could not load.');
      data = d; render();
    } catch (e) { $('wsStatus').textContent = e.message; }
  }
  document.addEventListener('DOMContentLoaded', () => {
    $('wsFind').onclick = startFind; $('wsStop').onclick = stopFind; $('wsCompass').onclick = compassOn;
    $('wsPhotos').onchange = async () => { for (const f of $('wsPhotos').files) await addFile(f); $('wsPhotos').value = ''; };
    $('wsSubmit').onclick = submit;
    $('wsMatchOpen').onclick = matchOpen; $('wsMatchClose').onclick = matchClose; $('wsMatchShoot').onclick = matchShoot;
    $('wsMatchFade').oninput = () => { $('wsMatchGhost').style.opacity = $('wsMatchFade').value / 100; };
    $('wsMatch').addEventListener('keydown', e => { if (e.key === 'Escape') matchClose(); });
    load();
  });
})(typeof self !== 'undefined' ? self : this);

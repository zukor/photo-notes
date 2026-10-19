// Reads the GPS location stored inside a photo (EXIF), for photos chosen from the library.
// A library photo may have been taken anywhere, so the phone's current location is never used for it.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PhotoNotesPhotoLocation = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Finds the EXIF block ("Exif\0\0" then a TIFF header) in a JPEG or HEIC file and returns its GPS position.
  function parse(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i + 14 < u8.length; i++) {
      if (u8[i] !== 0x45 || u8[i + 1] !== 0x78 || u8[i + 2] !== 0x69 || u8[i + 3] !== 0x66 || u8[i + 4] !== 0 || u8[i + 5] !== 0) continue;
      const t = i + 6, ii = u8[t] === 0x49 && u8[t + 1] === 0x49, mm = u8[t] === 0x4d && u8[t + 1] === 0x4d;
      if (!ii && !mm) continue;
      const found = tiff(u8, t, ii);
      if (found !== undefined) return found;
    }
    return null;
  }
  function tiff(u8, base, le) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const ok = o => o >= 0 && o + 4 <= u8.length;
    const u16 = o => dv.getUint16(o, le), u32 = o => dv.getUint32(o, le);
    if (!ok(base + 8) || u16(base + 2) !== 42) return undefined;
    const entries = ifd => { const out = new Map(); if (!ok(ifd + 2)) return out; const n = u16(ifd); for (let k = 0; k < n && k < 400; k++) { const e = ifd + 2 + k * 12; if (!ok(e + 12)) break; out.set(u16(e), { type: u16(e + 2), count: u32(e + 4), at: e + 8 }); } return out; };
    const ifd0 = entries(base + u32(base + 4)), gpsPtr = ifd0.get(0x8825);
    if (!gpsPtr) return null;
    const gps = entries(base + u32(gpsPtr.at));
    const ref = tag => { const e = gps.get(tag); return e ? String.fromCharCode(u8[e.at]) : ''; };
    const dms = tag => {
      const e = gps.get(tag); if (!e || e.type !== 5 || e.count < 3) return null;
      const o = base + u32(e.at); if (!ok(o + 24)) return null;
      const r = k => { const d = u32(o + k * 8 + 4); return d ? u32(o + k * 8) / d : NaN; };
      const v = r(0) + r(1) / 60 + r(2) / 3600; return Number.isFinite(v) ? v : null;
    };
    let lat = dms(2), lng = dms(4);
    if (lat == null || lng == null) return null;
    if (ref(1) === 'S') lat = -lat; if (ref(3) === 'W') lng = -lng;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
    return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
  }
  async function read(file) {
    try { if (!file || !file.slice) return null; return parse(await file.slice(0, 1024 * 1024).arrayBuffer()); } catch { return null; }
  }
  return { parse, read };
});

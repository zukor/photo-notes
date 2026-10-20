// Reads the GPS location and the original capture time stored inside a photo (EXIF), for photos chosen from the library.
// A library photo may have been taken anywhere, so the phone's current location is never used for it.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PhotoNotesPhotoLocation = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Finds the EXIF block ("Exif\0\0" then a TIFF header) in a JPEG or HEIC file and returns its GPS position.
  function scan(bytes, reader) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i + 14 < u8.length; i++) {
      if (u8[i] !== 0x45 || u8[i + 1] !== 0x78 || u8[i + 2] !== 0x69 || u8[i + 3] !== 0x66 || u8[i + 4] !== 0 || u8[i + 5] !== 0) continue;
      const t = i + 6, ii = u8[t] === 0x49 && u8[t + 1] === 0x49, mm = u8[t] === 0x4d && u8[t + 1] === 0x4d;
      if (!ii && !mm) continue;
      const found = reader(u8, t, ii);
      if (found !== undefined) return found;
    }
    return null;
  }
  function parse(bytes) { return scan(bytes, tiff); }
  // DateTimeOriginal (0x9003) in the Exif sub-IFD, "YYYY:MM:DD HH:MM:SS". OffsetTimeOriginal (0x9011) gives
  // its time zone when the camera recorded one; otherwise the time is read as this device's local time.
  function parseCaptureTime(bytes) { return scan(bytes, captureTime); }
  function captureTime(u8, base, le) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const ok = o => o >= 0 && o + 4 <= u8.length;
    const u16 = o => dv.getUint16(o, le), u32 = o => dv.getUint32(o, le);
    if (!ok(base + 8) || u16(base + 2) !== 42) return undefined;
    const entries = ifd => { const out = new Map(); if (!ok(ifd + 2)) return out; const n = u16(ifd); for (let k = 0; k < n && k < 400; k++) { const e = ifd + 2 + k * 12; if (!ok(e + 12)) break; out.set(u16(e), { type: u16(e + 2), count: u32(e + 4), at: e + 8 }); } return out; };
    const ascii = e => { if (!e || e.type !== 2 || !e.count) return ''; const at = e.count > 4 ? base + u32(e.at) : e.at; let out = ''; for (let k = 0; k < e.count && at + k < u8.length && u8[at + k]; k++) out += String.fromCharCode(u8[at + k]); return out.trim(); };
    const ifd0 = entries(base + u32(base + 4)), exifPtr = ifd0.get(0x8769);
    if (!exifPtr) return null;
    const exif = entries(base + u32(exifPtr.at));
    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(ascii(exif.get(0x9003)));
    if (!m) return null;
    const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
    if (y < 1990 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
    const offset = /^([+-])(\d{2}):(\d{2})$/.exec(ascii(exif.get(0x9011)));
    const time = offset
      ? Date.UTC(y, mo - 1, d, h, mi, se) - (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3])) * 60000
      : new Date(y, mo - 1, d, h, mi, se).getTime();
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
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
  async function readCaptureTime(file) {
    try { if (!file || !file.slice) return null; return parseCaptureTime(await file.slice(0, 1024 * 1024).arrayBuffer()); } catch { return null; }
  }
  return { parse, read, parseCaptureTime, readCaptureTime };
});

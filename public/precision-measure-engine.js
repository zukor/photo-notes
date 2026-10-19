/* PhotoNotes Precision Measure engine.
   Pure geometry and image math shared by the phone (browser) and the accuracy tests (Node):
   finding the measuring card, refining its corners to a fraction of a pixel, correcting the
   photo to a true overhead view, judging camera angle and distance, and measuring an outline.
   No network, no AI. Units: millimeters on the pavement plane, pixels in images. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PhotoNotesMeasureEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CARD_MARKER_ID = 7;              // the printed card carries this ArUco MIP 36h12 marker
  const CARD_DICTIONARY = 'ARUCO_MIP_36h12';
  const LIMITS = {
    tiltBestDeg: 10,        // auto-capture only at or below this angle
    tiltMaxDeg: 15,         // the shutter is refused above this angle
    cardMinFraction: 0.10,  // card side as a share of the shorter frame side: smaller means too far
    cardMaxFraction: 0.45,  // larger means too close to fit the pothole
    edgeMargin: 0.06,       // card corners must stay this far inside the frame
    steadyPx: 1.5,          // corner movement between frames (analysis pixels) that counts as steady
  };

  // ---------- small linear algebra ----------
  function solveLinear(A, b) {
    const n = b.length, M = A.map((row, i) => row.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }
  // Homography H (row-major 9 numbers) mapping src points to dst points (4 or more pairs; least squares when more).
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < src.length; i++) {
      const { x, y } = src[i], { x: u, y: v } = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    let h;
    if (A.length === 8) h = solveLinear(A, b);
    else {
      const At = A[0].map((_, c) => A.map(r => r[c]));
      const AtA = At.map(r => At.map(c => r.reduce((s, v, k) => s + v * c[k], 0)));
      const Atb = At.map(r => r.reduce((s, v, k) => s + v * b[k], 0));
      h = solveLinear(AtA, Atb);
    }
    return h ? h.concat([1]) : null;
  }
  function apply(H, x, y) {
    const w = H[6] * x + H[7] * y + H[8];
    return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
  }
  function multiply(A, B) {
    const C = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
    return C;
  }
  function invert(H) {
    const [a, b, c, d, e, f, g, h, i] = H;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-15) return null;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
            B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
            C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }

  // ---------- images ----------
  function grayFrom(rgba, w, h) {
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    return g;
  }
  function sampleGray(g, w, h, x, y) {
    if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return NaN;
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1), fx = x - x0, fy = y - y0;
    const a = g[y0 * w + x0], b = g[y0 * w + x1], c = g[y1 * w + x0], d = g[y1 * w + x1];
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
  }
  // Downscale RGBA by an integer-free factor with box averaging, for fast detection on large photos.
  function downscale(rgba, w, h, maxSide) {
    const s = Math.min(1, maxSide / Math.max(w, h));
    if (s >= 1) return { data: rgba, width: w, height: h, scale: 1 };
    const ow = Math.max(1, Math.round(w * s)), oh = Math.max(1, Math.round(h * s)), out = new Uint8ClampedArray(ow * oh * 4);
    const fx = w / ow, fy = h / oh;
    for (let y = 0; y < oh; y++) {
      const ys = Math.floor(y * fy), ye = Math.min(h, Math.floor((y + 1) * fy) || ys + 1);
      for (let x = 0; x < ow; x++) {
        const xs = Math.floor(x * fx), xe = Math.min(w, Math.floor((x + 1) * fx) || xs + 1);
        let r = 0, gg = 0, b = 0, n = 0;
        for (let yy = ys; yy < Math.max(ye, ys + 1); yy++) for (let xx = xs; xx < Math.max(xe, xs + 1); xx++) { const k = (yy * w + xx) * 4; r += rgba[k]; gg += rgba[k + 1]; b += rgba[k + 2]; n++; }
        const o = (y * ow + x) * 4; out[o] = r / n; out[o + 1] = gg / n; out[o + 2] = b / n; out[o + 3] = 255;
      }
    }
    return { data: out, width: ow, height: oh, scale: ow / w };
  }

  // ---------- finding the card ----------
  // detector: an AR.Detector for ARUCO_MIP_36h12 (js-aruco2). Returns the four outer corners of the card's black square.
  function detectCard(detector, rgba, w, h, maxSide = 1280) {
    const small = downscale(rgba, w, h, maxSide);
    const markers = detector.detect({ width: small.width, height: small.height, data: small.data }) || [];
    const m = markers.find(k => k.id === CARD_MARKER_ID);
    if (!m) return null;
    return m.corners.map(c => ({ x: (c.x + 0.5) / small.scale - 0.5, y: (c.y + 0.5) / small.scale - 0.5 }));
  }
  // Refine each side of the black square to sub-pixel accuracy by fitting a line to the strongest
  // dark-to-light transition across that side, then intersecting adjacent lines.
  function refineCorners(gray, w, h, corners) {
    const cx = corners.reduce((s, c) => s + c.x, 0) / 4, cy = corners.reduce((s, c) => s + c.y, 0) / 4;
    const lines = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4], dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      if (len < 8) return { corners, refined: false };
      let nx = -dy / len, ny = dx / len;
      if (((a.x + b.x) / 2 - cx) * nx + ((a.y + b.y) / 2 - cy) * ny < 0) { nx = -nx; ny = -ny; }
      const r = Math.max(3, Math.min(14, len * 0.04)), N = Math.max(12, Math.min(60, Math.round(len / 6))), pts = [];
      for (let k = 1; k <= N; k++) {
        const t = 0.12 + 0.76 * k / (N + 1), px = a.x + dx * t, py = a.y + dy * t, vals = [];
        for (let s = -r; s <= r + 1e-9; s += 0.5) vals.push(sampleGray(gray, w, h, px + nx * s, py + ny * s));
        if (vals.some(Number.isNaN)) continue;
        let best = 0, bi = -1;
        for (let j = 1; j < vals.length - 1; j++) { const d = vals[j + 1] - vals[j - 1]; if (d > best) { best = d; bi = j; } }
        if (bi < 2 || bi > vals.length - 3 || best < 20) continue;
        const dm = vals[bi] - vals[bi - 2], d0 = best, dp = vals[bi + 2] - vals[bi], den = dm - 2 * d0 + dp;
        const off = den !== 0 ? 0.5 * (dm - dp) / den : 0;
        const s = -r + (bi + Math.max(-0.5, Math.min(0.5, off))) * 0.5;
        pts.push({ x: px + nx * s, y: py + ny * s });
      }
      if (pts.length < N * 0.5) return { corners, refined: false };
      const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length, my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      let sxx = 0, sxy = 0, syy = 0;
      for (const p of pts) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); syy += (p.y - my) ** 2; }
      const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      lines.push({ px: mx, py: my, dx: Math.cos(ang), dy: Math.sin(ang) });
    }
    const out = [];
    for (let i = 0; i < 4; i++) {
      const L1 = lines[(i + 3) % 4], L2 = lines[i], det = L1.dx * L2.dy - L1.dy * L2.dx;
      if (Math.abs(det) < 1e-9) return { corners, refined: false };
      const t = ((L2.px - L1.px) * L2.dy - (L2.py - L1.py) * L2.dx) / det;
      out.push({ x: L1.px + L1.dx * t, y: L1.py + L1.dy * t });
    }
    // A refinement that moves a corner far from the detected one is rejected.
    if (out.some((p, i) => Math.hypot(p.x - corners[i].x, p.y - corners[i].y) > 6 + 0.05 * Math.hypot(corners[(i + 1) % 4].x - corners[i].x, corners[(i + 1) % 4].y - corners[i].y))) return { corners, refined: false };
    return { corners: out, refined: true };
  }

  // Plane coordinates (mm) of the card's black square, matching the clockwise image order of the corners.
  function cardPlanePoints(sideMm) { return [{ x: 0, y: 0 }, { x: sideMm, y: 0 }, { x: sideMm, y: sideMm }, { x: 0, y: sideMm }]; }
  // Homographies: pavement plane (mm) to image (px), and back.
  function planeToImage(corners, sideMm) {
    const H = homography(cardPlanePoints(sideMm), corners);
    return H ? { planeToImage: H, imageToPlane: invert(H) } : null;
  }

  // ---------- camera angle and distance ----------
  // Angle between the camera's viewing direction and straight down onto the pavement, from the card's shape.
  // focalPx: approximate focal length in pixels (image width / (2 tan(horizontal field of view / 2))).
  function tiltDegrees(Hpi, focalPx, cx, cy) {
    const Kinv = [1 / focalPx, 0, -cx / focalPx, 0, 1 / focalPx, -cy / focalPx, 0, 0, 1];
    const B = multiply(Kinv, Hpi);
    const h1 = [B[0], B[3], B[6]], h2 = [B[1], B[4], B[7]];
    const n1 = Math.hypot(...h1), n2 = Math.hypot(...h2);
    if (!n1 || !n2) return null;
    const r1 = h1.map(v => v / n1), r2 = h2.map(v => v / n2);
    const r3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
    const n3 = Math.hypot(...r3);
    return Math.acos(Math.min(1, Math.abs(r3[2] / n3))) * 180 / Math.PI;
  }
  function focalFromFov(width, hfovDeg) { return width / (2 * Math.tan(hfovDeg * Math.PI / 360)); }
  // Tilt of the phone itself from flat, from the browser's DeviceOrientation beta and gamma (degrees).
  function deviceTilt(beta, gamma) {
    if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return null;
    const c = Math.cos(beta * Math.PI / 180) * Math.cos(gamma * Math.PI / 180);
    return Math.acos(Math.max(-1, Math.min(1, Math.abs(c)))) * 180 / Math.PI;
  }
  function cardFraction(corners, w, h) {
    let s = 0; for (let i = 0; i < 4; i++) { const a = corners[i], b = corners[(i + 1) % 4]; s += Math.hypot(b.x - a.x, b.y - a.y); }
    return (s / 4) / Math.min(w, h);
  }
  // Coaching for one live frame. Returns the first problem to fix (most important first), or ready.
  function assessFrame({ corners, width, height, tilt, phoneTilt, steady }) {
    if (!corners) return { state: 'no_card', ready: false, capturable: false, message: 'Place the measuring card flat beside the pothole and point the camera straight down at both.' };
    const m = LIMITS.edgeMargin;
    const nearEdge = corners.some(p => p.x < width * m || p.y < height * m || p.x > width * (1 - m) || p.y > height * (1 - m));
    const frac = cardFraction(corners, width, height);
    const t = Math.max(tilt ?? 0, phoneTilt ?? 0);
    const base = { cardFraction: frac, tilt: t };
    if (frac < LIMITS.cardMinFraction) return { ...base, state: 'too_far', ready: false, capturable: false, message: 'Move the phone closer to the pavement.' };
    if (frac > LIMITS.cardMaxFraction) return { ...base, state: 'too_close', ready: false, capturable: false, message: 'Raise the phone so the whole pothole and card fit.' };
    if (nearEdge) return { ...base, state: 'near_edge', ready: false, capturable: false, message: 'Center the pothole and card. The card is too close to the edge of the picture.' };
    if (t > LIMITS.tiltMaxDeg) return { ...base, state: 'tilted', ready: false, capturable: false, message: `Hold the phone flatter, straight down over the pothole (${Math.round(t)}° now, 10° or less is best).` };
    if (t > LIMITS.tiltBestDeg) return { ...base, state: 'tilt_ok', ready: false, capturable: true, message: `Almost level (${Math.round(t)}°). Hold the phone a little flatter for the best result.` };
    if (!steady) return { ...base, state: 'hold_still', ready: false, capturable: true, message: 'Hold still.' };
    return { ...base, state: 'ready', ready: true, capturable: true, message: 'Good. Hold still.' };
  }
  function cornersMoved(a, b) {
    if (!a || !b) return Infinity;
    let m = 0; for (let i = 0; i < 4; i++) m = Math.max(m, Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y));
    return m;
  }

  // ---------- overhead view ----------
  // Plan the corrected overhead image: keep the photo's own resolution at the card, cover what the photo shows
  // within reach of the card, and cap the size so phones can process it.
  function planRectify(Hpi, imgW, imgH, sideMm, cornersPx, opts = {}) {
    const Hip = invert(Hpi);
    let side = 0; for (let i = 0; i < 4; i++) { const a = cornersPx[i], b = cornersPx[(i + 1) % 4]; side += Math.hypot(b.x - a.x, b.y - a.y); }
    let pxPerMm = Math.max(0.5, Math.min(4, (side / 4) / sideMm));
    const reach = opts.reachMm || 1800, c = sideMm / 2;
    const pts = [[0, 0], [imgW - 1, 0], [imgW - 1, imgH - 1], [0, imgH - 1]].map(([x, y]) => apply(Hip, x, y));
    // Points behind the camera or extremely far away (a steep view) are limited by the reach.
    let minX = Math.max(c - reach, Math.min(...pts.map(p => p.x))), maxX = Math.min(c + reach, Math.max(...pts.map(p => p.x)));
    let minY = Math.max(c - reach, Math.min(...pts.map(p => p.y))), maxY = Math.min(c + reach, Math.max(...pts.map(p => p.y)));
    if (!(maxX > minX && maxY > minY)) { minX = c - reach; maxX = c + reach; minY = c - reach; maxY = c + reach; }
    const maxPixels = opts.maxPixels || 9e6;
    let ow = Math.round((maxX - minX) * pxPerMm), oh = Math.round((maxY - minY) * pxPerMm);
    if (ow * oh > maxPixels) { const k = Math.sqrt(maxPixels / (ow * oh)); pxPerMm *= k; ow = Math.round(ow * k); oh = Math.round(oh * k); }
    const T = [1 / pxPerMm, 0, minX, 0, 1 / pxPerMm, minY, 0, 0, 1];
    return { pxPerMm, minX, minY, width: Math.max(1, ow), height: Math.max(1, oh), outputToImage: multiply(Hpi, T) };
  }
  // Warp rows [y0, y1) of the overhead image from the source photo (bilinear). Outside the photo is dark gray.
  function warpRows(src, sw, sh, H, dst, ow, y0, y1) {
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < ow; x++) {
        const wq = H[6] * x + H[7] * y + H[8], sx = (H[0] * x + H[1] * y + H[2]) / wq, sy = (H[3] * x + H[4] * y + H[5]) / wq, o = (y * ow + x) * 4;
        if (wq <= 0 || sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) { dst[o] = dst[o + 1] = dst[o + 2] = 70; dst[o + 3] = 255; continue; }
        const x0 = sx | 0, y0i = sy | 0, x1 = Math.min(x0 + 1, sw - 1), y1i = Math.min(y0i + 1, sh - 1), fx = sx - x0, fy = sy - y0i;
        const a = (y0i * sw + x0) * 4, b = (y0i * sw + x1) * 4, c = (y1i * sw + x0) * 4, d = (y1i * sw + x1) * 4;
        for (let k = 0; k < 3; k++) dst[o + k] = src[a + k] * (1 - fx) * (1 - fy) + src[b + k] * fx * (1 - fy) + src[c + k] * (1 - fx) * fy + src[d + k] * fx * fy;
        dst[o + 3] = 255;
      }
    }
  }
  function overheadToPlane(plan, x, y) { return { x: plan.minX + x / plan.pxPerMm, y: plan.minY + y / plan.pxPerMm }; }
  function planeToOverhead(plan, x, y) { return { x: (x - plan.minX) * plan.pxPerMm, y: (y - plan.minY) * plan.pxPerMm }; }

  // ---------- measuring an outline (mm) ----------
  function convexHull(points) {
    const p = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [], upper = [];
    for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }
  // Length and width are the sides of the smallest rectangle around the outline: what a saw-cut patch would need.
  function measureOutline(points) {
    if (!Array.isArray(points) || points.length < 3) return null;
    let a = 0, per = 0;
    for (let i = 0; i < points.length; i++) { const p = points[i], q = points[(i + 1) % points.length]; a += p.x * q.y - q.x * p.y; per += Math.hypot(q.x - p.x, q.y - p.y); }
    const hull = convexHull(points);
    let best = null;
    for (let i = 0; i < hull.length; i++) {
      const p = hull[i], q = hull[(i + 1) % hull.length], ang = Math.atan2(q.y - p.y, q.x - p.x), c = Math.cos(ang), s = Math.sin(ang);
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      for (const r of hull) { const u = r.x * c + r.y * s, v = -r.x * s + r.y * c; minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
      const area = (maxU - minU) * (maxV - minV);
      if (!best || area < best.area) best = { area, l: maxU - minU, w: maxV - minV, angle: ang };
    }
    return { areaMm2: Math.abs(a) / 2, perimeterMm: per, lengthMm: Math.max(best.l, best.w), widthMm: Math.min(best.l, best.w), rectAreaMm2: best.area, rectAngle: best.angle };
  }

  const MM_PER_IN = 25.4, SQIN_PER_SQFT = 144;
  return {
    CARD_MARKER_ID, CARD_DICTIONARY, LIMITS, MM_PER_IN, SQIN_PER_SQFT,
    homography, apply, invert, multiply, grayFrom, sampleGray, downscale,
    detectCard, refineCorners, cardPlanePoints, planeToImage,
    tiltDegrees, focalFromFov, deviceTilt, cardFraction, assessFrame, cornersMoved,
    planRectify, warpRows, overheadToPlane, planeToOverhead,
    convexHull, measureOutline,
  };
});

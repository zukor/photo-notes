# Approved Photo Notes AI icon package

Received September 5, 2026. All seven supplied artwork files are stored byte-for-byte.

- iOS native: use photo-notes-icon-1024.png, a full-bleed 1024px square.
- Android native: use the supplied foreground and background SVG layers.
  The smaller foreground is intentional for launcher masks.
- photo-notes-icon-master.svg is reference artwork only, never a build input.
- Browser favicons: copy the supplied 16px, 32px and 48px PNGs unchanged.

Do not alter colors (#e8231a / #ffffff), positioning, optical centering,
proportions or artwork. Do not add rounded outer corners, padding or effects.

This repository is a web app, not an Xcode/Android native project.
scripts/gen-icons.js resizes the iOS PNG for Apple touch and ordinary PWA icons.
For maskable PWA icons it composites the Android layers at their original
coordinates, then resizes the entire square. Source files are never rewritten.

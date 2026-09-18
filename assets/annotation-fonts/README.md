# Annotation rendering fonts

These unmodified Liberation fonts are distributed under the SIL Open Font License 1.1 in LICENSE. Font binaries were copied from the bundled LibreOffice runtime; the license was copied from the bundled pdfjs-dist Liberation font distribution.

Sans, serif, mono and bold sans cover the photo annotation font choices. `annotation-fonts.js` configures fontconfig before sharp initializes so the production container does not depend on system-installed fonts. Keep all four font files, fonts.conf, and LICENSE in the deployed app.

Do not use system fonts in the regression tests: that masks the production failure where text becomes missing-glyph boxes while arrows and rectangles still work.

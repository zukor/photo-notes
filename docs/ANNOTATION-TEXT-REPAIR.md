# Text annotation rendering repair

Ahsan's retest isolated text annotations: arrows and rectangles displayed correctly after saving, but text was missing or appeared as empty boxes.

A synthetic SVG rendered on the production container reproduced empty boxes for `Ahsan ABC 123 Location`. The container had no system font directory. Previous markup coverage tested rectangle pixels and missed this server-only text failure.

The app now includes licensed Liberation fonts and loads its fontconfig configuration before sharp/libvips initializes. This fixes text in saved-photo views, marked-photo downloads, sharing, and document images using the same renderer, including existing persisted annotations without a data migration. Cache version 202 refreshes the client shell.

Validation: 219 standard tests passed, 7 optional tests skipped. Thirteen dedicated tests exercise distinct glyphs in all four font choices and visible custom/date/address/GPS/topic/copyright/dimension/defect text using only bundled fonts. The separate disposable database integration test passes with custom text entered, saved, and reopened in Chromium and WebKit.

Production release status and the post-deploy synthetic rendering result are reported in the task reply. Tester confirmation remains separate.

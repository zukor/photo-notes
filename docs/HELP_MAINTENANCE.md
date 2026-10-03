# PhotoNotes AI Help

Help reads controls from the actual page in DOM order. It tracks asynchronous records, open dialogs, labels, selector choices, and feature removal with a MutationObserver. Only the current UI is listed, so editions and permissions determine their own Help without copied page implementations. Repeated equivalent controls are described once at their first occurrence.

Detailed instructions and 72 Key Terms live in `public/help-catalog.js`. Definitions support hover, focus, and tap. The right drawer takes 28% of desktop width and adapts to phone/tablet screens. Help is also loaded on sign-in, administration, installation, customer review, and completion-photo pages.

## Updating features

1. Use accessible labels and stable control IDs/classes/data attributes.
2. Add or revise the corresponding authored catalog rule and terms in the same feature change. Describe the actual outcome, required inputs, review, save/submit behavior, and any meaningful distinction between local storage, server upload, and external delivery.
3. Run `npm run help:check` and `npm test`. The coverage gate scans source controls, validates authored guidance, and runs during installation/start and CI.
4. Extend browser fixtures for dynamically constructed fields and new screens. Run `npm run test:help` for rendered page-order coverage, definitions, edition availability, responsive layout, and automatic insertion/removal updates.
5. Bump changed assets and service-worker cache together. After deployment verify the live release, health, assets, and UI.

The renderer automatically updates structural Help as the UI changes. Detailed semantics are authored, not invented by a generator. Release gates prevent shipping a new source control without that authored guidance; browser fixtures cover dynamic construction that a source scan cannot fully evaluate.

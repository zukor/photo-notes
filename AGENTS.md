# Repository instructions

- Keep answers brief and direct. Never use em dashes.
- Use black, left-aligned body text. In documents use Arial/Helvetica and black text.

## Shared PhotoNotes workflow

- Photo Notes Pro is the reference for shared features, behavior, labels, layouts, and UI styles in Organize, Edit, Create, and Send wherever those sections exist.
- Implement shared changes in common renderers and styles. Preserve every edition-specific feature/workflow.
- Verify affected sections across editions, at phone and desktop widths, including specialist actions.

## Help is part of every feature

- Every screen, dialog, control, and feature must have accurate, authored Help. Adding, changing, or removing a feature includes updating its explanation and Key Terms in the same change.
- `public/help.js` reads the current page's controls in DOM order and observes navigation, dialogs, asynchronous records, labels, options, and removal. Keep controls accessible with stable IDs, labels, classes, or `data-*` attributes.
- Put detailed instructions, save/delivery distinctions, and terms in `public/help-catalog.js`. Prefer stable control keys over translated text. Do not leave a new feature using generic fallback guidance.
- Help must reflect actual edition/account feature availability. Preserve context for specialist workflows.
- Desktop Help uses 28% of viewport width. On phones/tablets use the responsive drawer. Report Issue stays bottom left, yellow ? Help bottom right.
- Definitions must work on hover, keyboard focus, and tap. Help text stays black.
- Run `npm run help:check`, `npm test`, and `npm run test:help` before release. The installation/start gate and CI reject missing source-control guidance. Verify dynamic fields/dialogs in browser fixtures too.

## Property Manager Pro and global changes

- Include Property Manager Pro (`property`) in global edition lists, Help coverage, shared feature gates, and phone/desktop regression checks. It inherits shared Photo Notes behavior and the same property workflows as HOA Maintenance Pro through common code.
- Do not publish stale copies of shared files from an older branch. Integrate the latest main before releasing global changes and preserve the Property Manager edition registry, access grants, branding, and HOA endpoint authorization.
- Update Help when changing a screen or control. Verify Property Manager's searchable and contextual Help for shared tools and its capture, communities/team, assets/history, inspection routes, guided visits, maintenance/evidence, completion links, dashboard/notifications, and reports.
- Run `node scripts/test-property-global-parity.cjs` and `node scripts/test-all-edition-help.cjs` for shared UI or Help changes, along with the standard tests. Preserve specialist navigation and actions.

# Repository instructions

## Shared Photo Notes workflow

- Photo Notes Pro is the reference for shared features, behavior, labels, layouts, and UI styles in Organize, Edit, Create, and Send wherever those sections exist.
- Implement shared changes in the common renderers and styles so the other editions receive the same changes. Avoid edition-specific copies of shared UI.
- Preserve all edition-specific features and workflows. Industry features extend the shared workflow and must not be removed to achieve parity.
- Verify affected shared screens in every edition that exposes them, at phone and desktop widths. Verify that edition-specific actions remain available.
- Keep responses brief. Never use em dashes. Use black, left-aligned body text and standard fonts in documents.

## Property Manager Pro and global changes

- Include Property Manager Pro (`property`) in global edition lists, Help coverage, shared feature gates, and phone/desktop regression checks. It inherits shared Photo Notes behavior and the same property workflows as HOA Maintenance Pro through common code.
- Do not publish stale copies of shared files from an older branch. Integrate the latest main before releasing global changes and preserve the Property Manager edition registry, access grants, branding, and HOA endpoint authorization.
- Update Help when changing a screen or control. Verify Property Manager's searchable and contextual Help for shared tools and its capture, communities/team, assets/history, inspection routes, guided visits, maintenance/evidence, completion links, dashboard/notifications, and reports.
- Run `node scripts/test-property-global-parity.cjs` and `node scripts/test-all-edition-help.cjs` for shared UI or Help changes, along with the standard tests. Preserve specialist navigation and actions.

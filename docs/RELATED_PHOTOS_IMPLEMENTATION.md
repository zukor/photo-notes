# Related Photos

Shared Pro photo context for Photo Notes Pro, Paving, Concrete, Property Manager,
HOA Maintenance, General Contractor, and Roofer. Basic and both issue editions
have no access. Relationships are manually created between existing owned photos.

## Data model

`related_photos` stores user_id, canonical photo_a < photo_b, optional
relationship_type, optional note, created_at and updated_at. One unique row per
unordered pair. Foreign keys cascade on photo/account deletion. Additive,
idempotent startup migration, no existing records are updated. No relationship
limit. List, candidate search, counts, save/update and unlink APIs are authenticated
and edition gated. Mutations validate ownership, lock photos in ID order, and
record both photo histories in the same transaction. Repeated identical saves
create no history. History details contain related IDs and type, not private notes.

Types: Related Condition; Same Subject; Nearby Condition; Cause / Source;
Result / Effect; Supporting Evidence; Other. Unclassified is allowed.

## Existing infrastructure

Reuses captures, capture_history, authentication, active edition checks, shared
captureCardHtml, selectedIds and Create, and authored Help. Existing capture_pairs,
concrete_ticket_links, group_items, job_id, hoa_asset_photos and hoa_item_photos
retain their specialized semantics. General links never change these tables.

Saved photo cards in Organize/Edit expose Related Photos and a count when linked.
The dialog shows photo, title, date, note, optional relationship metadata, navigation,
searchable multi-selection, editing and unlinking. Select These Photos for a Document
adds only the current photo and directly related photos to the normal selection.
No automatic export inclusion. Relationships do not infer transitive links.

## Files and reconciliation

New: related-photos.js; public/related-photos.js; integration and browser scripts.
Minimal shared hooks: db.js, server.js, public/app.js, public/index.html,
public/help-catalog.js. Release additionally synchronizes public/sw.js,
public/admin.html, public/install.html and the Help version regression assertion.

The working checkout contains extensive concurrent uncommitted changes and was
34 commits behind main. Release was constructed from current origin/main with
only this feature's modular files and hooks. It deliberately excludes other local
work. Preserve Related Photos script loading, migration/route registration, card
button, history labels and Help rules when reconciling Photo Sets, Before/After,
Location, comments and property workflows. Do not publish entire stale shared files.

## Limitations

Only the current account's owned saved photos can be linked. Shared team-owned
photos are not selectable. Network required. Relationship labels express user
context, not verified cause/effect. Existing specialized viewers keep their normal
navigation; link discovery starts from shared saved photo cards. Real physical-device
acceptance remains separate from Chromium/WebKit browser checks.

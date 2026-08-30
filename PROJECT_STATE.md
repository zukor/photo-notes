# Photo Notes — Project State & Resume Guide

_Last updated: 2026-08-29 (production naming, Stripe sandbox, and health gate). This document is the single source of truth for
resuming work on the Photo Notes app after any delay. It captures what the
app is, where it lives, how it is built and deployed, the full feature set,
and everything still pending. If you are a Claude session picking this up
cold, read this file first._

---

## 1. What this is

**Photo Notes** — tagline "Photo documentation, by voice." A private,
multi-user web app for documenting maintenance/field issues. You take a
photo, say (or type) a note about it, and it is saved with GPS location and
address. Captures can be filtered, edited, grouped into titled ordered
reports, and exported to PDF, Word, or a "For Claude" zip bundle. Built for
Sam Turcotte (Elm Creek HOA, San Antonio; founder of Zukor AI). Intended to
later be integrated into the Elm Creek Board Hub.

Each person signs in with **email + password** and sees ONLY their own
captures, groups, and areas (per-user data isolation). Sam is being given
free/testing logins to real customers across different industries. There is
an **admin area at `/admin`** (admins only) for creating logins and watching
usage via metadata (counts, dates, upload/location rates) — never note text
or photos, by design (privacy).

## 2. Where it lives (all IDs)

- **Live URL:** https://photonotesapp.com
- **GitHub repo:** `zukor/photo-notes` (branch `main`). This holds all code
  and full history.
- **Railway project:** `Zukor Production Apps` (id `62580ecc-2e07-4e27-b2de-fedbb7bf263d`)
  - **Service (the live app):** `Photo Notes Production`
    (id `f1c5c40a-c946-4c48-a750-a38a45ce4877`)
  - **Environment:** `production`
    (id `582f1452-88f5-4da5-9724-710c12d47215`)
  - Postgres runs as a separate service in the same project.
- **Legacy service:** `Photo Notes Legacy`
  (id `6244cf58-03cb-4648-acc4-342cc0bd0234`). It is not the live app.
- **Separate legacy project:** `photo-notes`
  (id `93c5e666-eb84-4b4a-9428-1ebc47ddc9d6`). It is not the live app.
  Do not deploy production changes to either legacy target.

## 3. Required Railway environment variables (on Photo Notes Production)

- `ADMIN_EMAIL` — the admin account's email (defaults to
  `turcotte@zukor.com` if unset). Seeded as the first user on a fresh DB.
- `ADMIN_PASSWORD` — the admin account's starting password (seeds the admin
  user on first boot; after that, change it from the admin area).
- `DATABASE_URL` — Postgres connection string (literal value; Railway
  reference variables did NOT resolve reliably here, so a literal copy is used).
- `SESSION_SECRET` — JWT signing secret.
- `UPLOAD_DIR` — points at the mounted volume (photos persist there).
- `PORT` = 8080 (domain targetPort is 8080).
- `NODE_ENV` = production.
- `PUBLIC_BASE_URL` = `https://photonotesapp.com`.
- `UPLOAD_PERSISTENCE_CONFIRMED` = `true` (the live service has a Railway
  volume mounted at `/data/uploads`).
- `STRIPE_RESTRICTED_KEY`, `STRIPE_WEBHOOK_SECRET`, and
  `STRIPE_CHECKOUT_OFFERS_JSON` configure the Stripe sandbox integration.
- **`MAPBOX_TOKEN`** — NOT YET SET. Add a free Mapbox default public token
  (starts `pk.`) to get accurate US addresses. Until then the app falls back
  to free OpenStreetMap/Nominatim, which is inaccurate (wrong street/ZIP).
  Sam prefers Mapbox over Google. `GOOGLE_MAPS_API_KEY` is also supported by
  the code but intentionally unused.
- A persistent **volume** is attached for `/data/uploads` (photo storage).
  Railway also uses `/api/health` as the deployment health check.

## 4. How deploys work (IMPORTANT)

- Railway auto-builds on every push to `main`. Build = `npm install` (there
  is intentionally **no package-lock.json** so the `sharp` dependency
  resolves cleanly; do not re-add a lockfile unless you also keep it in sync).
- **Direct `git push` is blocked** by the session git proxy ("repository not
  in this session's authorized sources"). Pushing is done via the **GitHub
  MCP** (`push_files`, `delete_file`), authenticated as `zukor`, which works.
- Because a bad `server.js`/`db.js` can crash boot, the safe deploy pattern
  used here is **candidate-verify-promote**: push each large/critical file to
  a `*_candidate.js` path first, confirm its git blob SHA matches the local
  `git hash-object` value (byte-for-byte), then promote the identical content
  to the real path, then delete the candidate. This guarantees no
  transcription error ever reaches the running app.
- After a push, verify the deployment reached `SUCCESS` (Railway MCP
  `list-deployments`) and that boot logs show `[db] schema ready` and
  `[efc] listening on 8080`.

## 5. Tech stack & file map

- Node.js + Express single service serving the API and static frontend.
- Postgres via `pg` (schema auto-creates on boot; see `db.js`).
- `multer` disk uploads to the volume; `sharp` for image resize/rotate;
  `pdfkit` (PDF), `docx` (Word), `archiver` (zip) for exports.
- JWT signed-cookie auth (cookie `pn_token`); passwords hashed with
  `bcryptjs`. Multiple users, each with role `user` or `admin`.
- Frontend is a vanilla-JS single-page app (no framework), PWA-capable
  (manifest + service worker).

Files:
- `server.js` — all API routes + export generation + static serving.
- `db.js` — pg pool, schema (users, user_areas, events, captures, groups,
  group_items, areas), first-boot admin seeding, legacy-data backfill to the
  admin user, and per-user default-area seeding (`seedUserAreas`).
- `public/admin.html` — standalone admin page served at `/admin` (create
  logins, per-user usage metadata, reset password, deactivate/activate).
- `public/app.js` — the entire SPA (render + all handlers).
- `public/styles.css` — styling. Accent color is a CSS var `--accent`
  (currently blue `#1d4ed8`; change this one value to re-theme).
- `public/index.html`, `public/manifest.json` — shell + PWA manifest
  (theme color also `#1d4ed8`).
- `public/sw.js` — service worker (network-first; cache name bumped to bust
  stale assets — currently `efc-shell-v7`).
- `scripts/gen-icons.js` — regenerates PNG icons at build (postinstall).
- `railway.json` — NIXPACKS builder, `node server.js` start command.

## 6. Data model (Postgres)

- `users` — id, email (UNIQUE), name, password_hash (bcrypt), role
  ('user'|'admin'), industry, active (bool), created_at, last_login_at.
- `user_areas` — user_id, name, created_at, PK(user_id, name). Per-user area
  lists (each user edits their own; new users seeded with the defaults).
- `events` — id, user_id, action, detail (JSONB), created_at. Activity log
  powering the admin usage dashboard. Stores only WHAT was done (login,
  export, rotate, note_edit, delete, group_create/add/reorder, fix_addresses),
  never note text or photos. detail holds small facts like export format.
- `captures` — id, user_id (owner), created_at, captured_by, photo_path,
  photo_width, photo_height (oriented dims, for landscape/portrait stats),
  note, latitude,
  longitude, address, area_tags (text[]), kind ('note'|'task'), status,
  assignee, source. Raw lat/long is always stored so addresses can be
  re-computed later without re-walking.
- `groups` — id, user_id (owner), created_at, title, description.
- `group_items` — group_id, capture_id, position (ordered membership;
  many-to-many, cascade on delete).
- `areas` — name (PK), created_at. Editable list of area tags, seeded with
  Roads, Maintenance, Walls, Security, Landscaping, Other.

## 7. Features built (all live)

- **Five-stage workflow:** the primary navigation is entirely action-based:
  Capture, Organize, Edit, Create, Send. Selection persists between stages.
  Organize owns topics, grouping, sequencing, and the map; Edit owns photo and
  text manipulation; Create builds ordered titled documents; Send handles raw
  photos, PDF, Word, AI ZIP, native sharing, downloads, and printing.

- **Capture:** Take photo (camera) or Choose from library/files; note field
  with a "Record note" dictation button. On iPhone/iPad, Safari's in-page
  speech API starts but returns no words, so there the button routes to
  Apple's reliable keyboard dictation mic instead; desktop Chrome/Android
  still records in-page. Location captured at photo time and shown as
  GPS coordinates + Address; editable Area chips (add/delete, server-saved);
  Save.
- **Organize:** filter by topic; persistent multi-select; create topics; bulk-file
  selected captures under a topic; add them to a new or existing document; and
  open the map. This replaces the old place-oriented Library navigation.
- **Edit:** per-item note/caption editing; non-destructive crop; restore original;
  rotate 90° left/right; horizontal flip; photo stamps/overlays (including date,
  address, GPS, topic, custom text, and boxes); address repair; and deletion.
- **Create:** create a titled document with optional description directly from
  the current selection; reorder (Up/Down), reverse order, remove items, edit
  title/description, preview/build PDF/Word/ZIP, then continue to Send. The
  underlying storage remains the existing `groups`/`group_items` schema.
- **Send:** select recent captures and share their original images with captions,
  or deliver any saved document as a shared PDF, printed PDF, downloaded PDF,
  Word document, or AI-ready ZIP. Browsers without file sharing fall back to a
  download that can be attached or uploaded normally.
- **Export:** PDF, Word, and "For Claude (.zip)" (markdown + photos), with a
  drill-down for photo **resolution** (Standard 2048 / Print 3000 / Full /
  Web 1400) and **format** (JPEG / PNG / WebP / original). Originals are kept
  full-resolution on the server; export settings only shape the copy.
  Default Standard JPEG keeps zips small enough to upload to another Claude
  thread.
- **Responsive** layout verified 320–1440px; small-phone media query.
- **Device default view:** phones open to Capture, computers open to the
  saved list.
- **Multi-user logins:** email + password sign-in; each user sees only their
  own captures, groups, and areas. Legacy pre-multi-user data was backfilled
  to the admin account on migration.
- **Admin area (`/admin`, admins only):** create a login (name, email,
  industry, starting password); reset a login's password; deactivate/activate
  a login (data kept). Per-user usage cards grouped into sections: Captures
  (total, last 7/30 days, with-photo, with-location, tasks, first/latest);
  Photos (landscape / portrait / square orientation counts); Notes (with-a-
  note, avg / longest / total characters, edits — length only, text never
  shown); Exports (total, PDF, Word, Claude .zip); Groups (groups, photos
  grouped, add actions, reorders); Other activity (rotations, deletes, address
  fixes); plus logins and last-active. Metadata only — the admin view never
  exposes note text or photos. A one-time boot backfill filled photo
  orientation for photos captured before dimensions were tracked.
- **Admin password recovery:** setting env `ADMIN_PASSWORD_RESET=1` (with a new
  `ADMIN_PASSWORD`) forces the admin account's password on next boot, then the
  flag is cleared so ordinary redeploys never override a later change.

## 8. iOS Safari page zoom (support note)

If the layout looks enlarged/clipped on iPhone, it is Safari's per-site page
zoom, not the app. Fix on iPhone: tap the **aA** button at the LEFT end of
the address bar; the menu shows the current zoom percentage as a button at
the top — tap it (or the smaller "A") until it reads **100%**.

## 9. Pending / roadmap (nothing here is lost — just not done yet)

1. **Add `MAPBOX_TOKEN`** in Railway for accurate addresses, then run
   "Fix addresses" once to correct existing records. Also confirm iOS
   Precise Location is ON for Safari.
3. **Photo enhancement** (deliberately deferred): auto-enhance, brightness,
   contrast — to be done non-destructively (not overwriting originals).
4. **Logo + final colors.** Currently blue `#1d4ed8`; may become blue with
   red accents, or black/white. Change `--accent` in styles.css (+ theme
   color in index.html/manifest.json) once decided. Logo brief exists in the
   fieldwork docs.
5. **Legacy cleanup:** delete the legacy service/project noted in §2 only
   after a final data/source audit confirms nothing unique remains.
6. **Board Hub integration** (embed into the Elm Creek Board Hub later).

_(Done: multi-user / per-person logins with per-customer isolation and the
admin area shipped 2026-08-17. Expanded admin analytics + iPhone dictation
fix shipped 2026-08-18.)_

## 10. How to resume

1. Read this file.
2. `git clone` or browse `zukor/photo-notes` for current code.
3. To change the app: edit files, then deploy via the GitHub MCP using the
   candidate-verify-promote pattern in §4 (NOT direct git push — proxy blocks
   it). Railway auto-builds; verify SUCCESS + boot logs.
4. Local dev needs `DATABASE_URL` to a Postgres and the env vars in §3.

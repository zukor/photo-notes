# Photo Notes — Project State & Resume Guide

_Last updated: 2026-08-17. This document is the single source of truth for
resuming work on the Photo Notes app after any delay. It captures what the
app is, where it lives, how it is built and deployed, the full feature set,
and everything still pending. If you are a Claude session picking this up
cold, read this file first._

---

## 1. What this is

**Photo Notes** — tagline "Photo documentation, by voice." A private,
admin-only web app for documenting maintenance/field issues. You take a
photo, say (or type) a note about it, and it is saved with GPS location and
address. Captures can be filtered, edited, grouped into titled ordered
reports, and exported to PDF, Word, or a "For Claude" zip bundle. Built for
Sam Turcotte (Elm Creek HOA, San Antonio; founder of Zukor AI). Intended to
later be integrated into the Elm Creek Board Hub.

## 2. Where it lives (all IDs)

- **Live URL:** https://photonotesapp.com
- **GitHub repo:** `zukor/photo-notes` (branch `main`). This holds all code
  and full history.
- **Railway project:** `cozy-purpose` (id `62580ecc-2e07-4e27-b2de-fedbb7bf263d`)
  - **Service (the live app):** `selfless-youth`
    (id `f1c5c40a-c946-4c48-a750-a38a45ce4877`)
  - **Environment:** `production`
    (id `582f1452-88f5-4da5-9724-710c12d47215`)
  - Postgres runs as a separate service in the same project.
- **Dud/leftover to delete when convenient:** a never-deployed service also
  named `photo-notes` (id `6244cf58-03cb-4648-acc4-342cc0bd0234`) in
  cozy-purpose, plus an empty separate project also called `photo-notes`
  (id `93c5e666-...`). Neither is the live app; safe to remove.

## 3. Required Railway environment variables (on selfless-youth)

- `ADMIN_PASSWORD` — the single admin login password.
- `DATABASE_URL` — Postgres connection string (literal value; Railway
  reference variables did NOT resolve reliably here, so a literal copy is used).
- `SESSION_SECRET` — JWT signing secret.
- `UPLOAD_DIR` — points at the mounted volume (photos persist there).
- `PORT` = 8080 (domain targetPort is 8080).
- `NODE_ENV` = production.
- **`MAPBOX_TOKEN`** — NOT YET SET. Add a free Mapbox default public token
  (starts `pk.`) to get accurate US addresses. Until then the app falls back
  to free OpenStreetMap/Nominatim, which is inaccurate (wrong street/ZIP).
  Sam prefers Mapbox over Google. `GOOGLE_MAPS_API_KEY` is also supported by
  the code but intentionally unused.
- A persistent **volume** is attached for `/data/uploads` (photo storage).

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
- JWT signed-cookie auth, single admin password.
- Frontend is a vanilla-JS single-page app (no framework), PWA-capable
  (manifest + service worker).

Files:
- `server.js` — all API routes + export generation + static serving.
- `db.js` — pg pool, schema (captures, groups, group_items, areas), and
  default-area seeding.
- `public/app.js` — the entire SPA (render + all handlers).
- `public/styles.css` — styling. Accent color is a CSS var `--accent`
  (currently blue `#1d4ed8`; change this one value to re-theme).
- `public/index.html`, `public/manifest.json` — shell + PWA manifest
  (theme color also `#1d4ed8`).
- `public/sw.js` — service worker (network-first; cache name bumped to bust
  stale assets — currently `efc-shell-v3`).
- `scripts/gen-icons.js` — regenerates PNG icons at build (postinstall).
- `railway.json` — NIXPACKS builder, `node server.js` start command.

## 6. Data model (Postgres)

- `captures` — id, created_at, captured_by, photo_path, note, latitude,
  longitude, address, area_tags (text[]), kind ('note'|'task'), status,
  assignee, source. Raw lat/long is always stored so addresses can be
  re-computed later without re-walking.
- `groups` — id, created_at, title, description.
- `group_items` — group_id, capture_id, position (ordered membership;
  many-to-many, cascade on delete).
- `areas` — name (PK), created_at. Editable list of area tags, seeded with
  Roads, Maintenance, Walls, Security, Landscaping, Other.

## 7. Features built (all live)

- **Capture:** Take photo (camera) or Choose from library/files; note field
  with a "Record note" dictation button (in-page speech where supported,
  keyboard-mic hint otherwise); location captured at photo time and shown as
  GPS coordinates + Address; editable Area chips (add/delete, server-saved);
  Save.
- **Captures list** (the saved items view — tab currently named "Captures",
  rename pending, see §9): filter by area; per-item Edit note; rotate photo
  90° left/right (rewrites stored file); select captures; add selected to a
  group; delete selected; "Fix addresses" (re-geocode).
- **Groups:** create with title + description; add selected captures; open a
  group to reorder (Up/Down), Reverse order, remove items, edit
  title/description; export the group as a titled ordered PDF/Word/zip.
- **Export:** PDF, Word, and "For Claude (.zip)" (markdown + photos), with a
  drill-down for photo **resolution** (Standard 2048 / Print 3000 / Full /
  Web 1400) and **format** (JPEG / PNG / WebP / original). Originals are kept
  full-resolution on the server; export settings only shape the copy.
  Default Standard JPEG keeps zips small enough to upload to another Claude
  thread.
- **Responsive** layout verified 320–1440px; small-phone media query.
- **Device default view:** phones open to Capture, computers open to the
  saved list.

## 8. iOS Safari page zoom (support note)

If the layout looks enlarged/clipped on iPhone, it is Safari's per-site page
zoom, not the app. Fix on iPhone: tap the **aA** button at the LEFT end of
the address bar; the menu shows the current zoom percentage as a button at
the top — tap it (or the smaller "A") until it reads **100%**.

## 9. Pending / roadmap (nothing here is lost — just not done yet)

1. **Rename the second tab.** "Capture" and "Captures" are too similar.
   "Capture" stays; the saved-items tab needs a clearer name (candidates
   discussed: Library, Gallery, Log, Saved). Awaiting Sam's pick.
2. **Add `MAPBOX_TOKEN`** in Railway for accurate addresses, then run
   "Fix addresses" once to correct existing records. Also confirm iOS
   Precise Location is ON for Safari.
3. **Photo enhancement** (deliberately deferred): auto-enhance, brightness,
   contrast — to be done non-destructively (not overwriting originals).
4. **Logo + final colors.** Currently blue `#1d4ed8`; may become blue with
   red accents, or black/white. Change `--accent` in styles.css (+ theme
   color in index.html/manifest.json) once decided. Logo brief exists in the
   fieldwork docs.
5. **Delete the dud services** noted in §2.
6. **Multi-user / per-person logins** (currently single admin password).
7. **Board Hub integration** (embed into the Elm Creek Board Hub later).

## 10. How to resume

1. Read this file.
2. `git clone` or browse `zukor/photo-notes` for current code.
3. To change the app: edit files, then deploy via the GitHub MCP using the
   candidate-verify-promote pattern in §4 (NOT direct git push — proxy blocks
   it). Railway auto-builds; verify SUCCESS + boot logs.
4. Local dev needs `DATABASE_URL` to a Postgres and the env vars in §3.

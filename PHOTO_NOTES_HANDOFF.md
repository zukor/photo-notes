# Photo Notes — Engineering Handoff

**Product:** Photo Notes, a private multi-user photo-documentation web app (PWA) for paving and field work.
**Live URL:** https://photonotesapp.com
**Owner:** Zukor AI (Sam Turcotte)
**Last updated:** 2026-08-24

This document is the single source of truth for picking up development. It covers the architecture, how to deploy, the full feature set, the data model, environment configuration, known constraints, and the outstanding backlog. Where a detail is safety-critical or easy to get wrong, it is called out explicitly.

---

## 1. What the app is

Photo Notes lets a field worker capture a photo, attach a voice or typed note, auto-tag it with GPS and a street address, organize captures by topic and by site group, and export professional documentation (PDF, Word, and an AI-ready ZIP bundle). A "Pro" tier adds measurement, AI defect classification, per-site condition scoring, a satellite map, before/after pairing, and a proposal report.

It is installable as a PWA (works offline for the app shell) and is designed mobile-first, because the primary user is on a phone in the field.

The product navigation follows the user's actual work: **Capture → Organize →
Edit → Create → Send**. Create is optional; edited individual photos can go
straight to Send. The former Library and Groups concepts remain internal data
structures, not primary navigation labels.

---

## 2. Architecture at a glance

| Layer | Technology | File(s) |
|---|---|---|
| Web server + API | Node.js + Express (single service) | `server.js` |
| Database access | PostgreSQL via `pg` (connection pool) | `db.js` |
| Frontend | Vanilla-JS single-page app (no framework) | `public/app.js` |
| Frontend add-on | Vanilla-JS enhancement script | `public/send.js` |
| Styling | Plain CSS with a few CSS variables | `public/styles.css` |
| PWA shell | Service worker + manifest | `public/sw.js`, `public/manifest.json`, `public/index.html` |
| Image processing | `sharp` (resize, rotate, crop, SVG-text compositing) | in `server.js` |
| Exports | `pdfkit` (PDF), `docx` (Word), `archiver` (ZIP) | in `server.js` |
| AI vision | Anthropic Messages API | in `server.js` |
| Maps | Leaflet (CDN) + Mapbox/Esri satellite tiles | in `public/app.js` |
| Build hook | Icon generation at `postinstall` | `scripts/gen-icons.js` |

There is no build step for the frontend. `app.js` and `send.js` are served as-is. The only build-time action is `scripts/gen-icons.js` (runs on `npm install` / `postinstall`) which renders the PNG app icons from the mark SVG.

---

## 3. Repository and deployment

**Repo:** `github.com/zukor/photo-notes`, branch `main`.

**Host:** Railway.
- Project: `photo-notes` (id `93c5e666-eb84-4b4a-9428-1ebc47ddc9d6`)
- Service: `photo-notes` (id `d180b50f-555c-4869-8d0d-235e3cd56912`)
- Environment: `production` (id `6cc1ac53-3920-4b74-ae32-87e5551e1bc6`)
- Railway auto-builds and deploys on every push to `main`.

**Deploy flow:** commit to `main` → Railway builds (`npm install` runs `postinstall` → `gen-icons.js`) → starts the service → app is live within ~60 to 120 seconds.

**Verify a deploy is healthy:**
1. `GET https://photonotesapp.com/` returns 200.
2. `GET https://photonotesapp.com/api/me` returns 401 when unauthenticated (proves the Express app booted, not just static files).
3. Railway build logs show the DB schema initialize and the server listen line.

### 3.1 IMPORTANT: how files get pushed (read before deploying)

Direct `git push` to this repo is blocked by the environment's git proxy, and the raw GitHub REST contents API rejects the proxy token. The **only** authorized write path in the assistant tooling is the GitHub MCP `create_or_update_file` call.

Practical rules that were learned the hard way:

- **Small files** (CSS, SVG, `sw.js`, `send.js`, `gen-icons.js`, `index.html`, `manifest.json`) push cleanly in one call. Always pass the current blob SHA as the update base, and after the push confirm the returned `content.sha` matches the local `git hash-object` of the file. A match proves byte-for-byte fidelity.
- **Large files** (`server.js` ~120KB, `public/app.js` ~130KB) are near or over the assistant's single-message output limit. Pushing them requires care and can fail. When it fails mid-push it can leave a **broken partial file live** (this happened once and briefly took the app down). Always verify `GET /app.js` parses and contains expected markers after any large push.
- Because of the above, several recent UI changes were shipped as a **separate small file, `public/send.js`**, instead of editing the big `app.js`. See section 6.
- A binary file (like a PNG) cannot be pushed through `create_or_update_file` (it base64-encodes text). Binary icons are instead **generated at build time** from an SVG by `gen-icons.js`. Do not try to commit PNGs directly.

### 3.2 IMPORTANT: ephemeral build/edit environment

The assistant's working container is ephemeral and is frequently reset between turns. Local uncommitted edits are wiped on reset; production and GitHub are never affected. **Always re-fetch the current deployed files as your edit base** (e.g. `curl https://photonotesapp.com/app.js -o app.js`) before editing, and deploy promptly. Never assume the local working copy is current.

---

## 4. Environment variables

Set these on the Railway service. Names below are exactly as read by the code.

**Database (`db.js`):**
- `DATABASE_URL` — Postgres connection string (required).
- `PGSSL` — set to `require` to enable TLS with `rejectUnauthorized:false`; otherwise SSL is off.
- `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` — seed the initial admin user on first boot.
- `ADMIN_PASSWORD_RESET` — if set, resets the admin password on boot (use once, then remove).

**Server (`server.js`):**
- `SESSION_SECRET` — secret for signing the JWT auth cookie (required in production). Note: it is `SESSION_SECRET`, not `JWT_SECRET`.
- `ANTHROPIC_API_KEY` — enables all AI features (measure-from-photo, defect classification). If unset, those features soft-fail to null and the rest of the app works.
- `VISION_MODEL` — overrides the vision model. Default is `claude-sonnet-4-6`.
- `MAPBOX_TOKEN` — enables Mapbox satellite tiles and Mapbox geocoding. Without it, the map falls back to Esri satellite tiles.
- `GOOGLE_MAPS_API_KEY` — preferred reverse-geocoder (address lookup). Falls back to Mapbox, then to OpenStreetMap Nominatim.
- `UPLOAD_DIR` — where uploaded photos are stored on disk (defaults to `<app>/uploads`). On Railway this should point at a persistent volume so photos survive redeploys.
- `NODE_ENV`, `PORT` — standard.

**User actions still outstanding** (operational, not code): confirm `ANTHROPIC_API_KEY`, `MAPBOX_TOKEN`, and `GOOGLE_MAPS_API_KEY` are set in Railway; confirm `UPLOAD_DIR` points at a persistent volume; set the primary account to the Pro plan in `/admin`.

---

## 5. Authentication and accounts

- Auth is a JWT stored in a signed cookie named `pn_token`. Login is `POST /api/login` with `{email, password}`. Passwords are bcrypt hashes.
- **There is no self-registration.** Users are created by an admin via `POST /api/admin/users` (admin UI at `/admin`). The first admin is seeded from the `ADMIN_*` env vars.
- Roles: `admin` and normal user. Plans: `free` and `pro` (column `users.plan`).
- `currentPlan(userId)` reads the plan fresh from the DB on each relevant request, so an admin plan change takes effect on the user's next page load without requiring re-login.
- Login uses the email exactly as stored (lowercased). The account for this deployment is `turcotte@zukor.com`. A common support issue is typing a different email.

---

## 6. The `send.js` add-on (why it exists)

`public/send.js` is loaded after `app.js` from `index.html`. It exists because editing the large `app.js` is a fragile deploy (section 3.1), so recent UI enhancements were implemented as a small, independently-deployable script that manipulates the DOM after `app.js` renders. It uses a `MutationObserver` to re-apply its changes on every re-render, plus guarded logic to avoid infinite observer loops.

`send.js` currently does three things:

1. **Send / Send & Save buttons** on the Capture screen (below Save). "Send" opens the device native share sheet (`navigator.share`) with the photo file plus a caption (note + address/GPS + timestamp); on desktop browsers without Web Share it falls back to downloading the photo and opening a pre-filled email. "Send & Save" also commits the record to the library (it clicks the app's own Save first, then shares).
2. **Zukor AI corner logo** placement and size: moves the small `zukor-logo.svg` to the far left of the header (Log out stays on the right) and sizes it to 12px tall.
3. **Collapsible Topic area**: collapses the topic picker to a single tappable line ("Topic ▾", or "Topic: <selection> ▾" once chosen). Tapping expands to the topic chips (one horizontally-scrollable row) and the add-a-topic field. Tapping a chip selects it and re-collapses.

**Design note / tech debt:** these three behaviors ideally belong inside `app.js`. They live in `send.js` only to avoid the large-file deploy risk. When `app.js` is next edited and deployed safely, consider folding them in. The two implementations are compatible (each guards against double-injection), so there is no conflict if both exist.

---

## 7. Feature set

### 7.1 Core (all tiers)
- **Capture:** take or choose a photo; add a note by voice (Web Speech dictation) or typing; auto GPS + reverse-geocoded street address; tag with a topic.
- **Instant / background save:** the record commits immediately and the photo uploads in the background (one-at-a-time, auto-retry with backoff, resumes when back online). A small "Uploading…" pill shows progress.
- **Background address lookup:** geocoding is off the save path. The save returns instantly with coordinates; the server reverse-geocodes afterward and fills the address, which appears on the next Library refresh.
- **Library:** list, filter by topic, edit notes, rotate photos, crop photos (non-destructive, original restorable), delete, and add stamps/annotations.
- **Groups:** organize captures into named site groups, reorder, and export per group.
- **Photo overlays / stamps editor:** burn date/time, address, GPS, topic, copyright, custom text, and colored rectangles onto a photo. Text supports font, color, size, and an outline for legibility. Rectangles support drag, corner-resize, color, and line thickness. Rendered server-side with `sharp` + SVG compositing. Overlays are stored as JSON on the capture and are also applied to exports.
- **Crop:** drag/resize a crop box; applying it trims the photo and saves the pristine original as a backup, with a "Restore Original Photo" button to revert. Non-destructive.
- **Exports:** PDF (`pdfkit`), Word (`docx`), and an "For AI" ZIP bundle (`archiver`). Selectable image resolution/format.

### 7.2 Pro tier (gated by `users.plan = 'pro'`)
- **Dimensions:** per-capture length/width/depth/shape and computed area (sq ft).
- **AI measure-from-photo:** estimate dimensions from a photo using a reference object (e.g. a ruler); low-confidence estimates are held out of exports until the user confirms.
- **AI defect classification (F1):** classify pavement defects with a severity badge; user can override.
- **Per-site condition score (F2):** a 0-100 score with a color band, aggregated from a site's captures.
- **Satellite Map tab (F3):** Leaflet map of captures over satellite imagery (Mapbox or Esri).
- **Before/After pairing (F4):** pair two captures; shown as a combined card.
- **Proposal report (F5):** a client-facing proposal PDF/Word with recommended fixes and quantities.
- **Satellite Takeoff / measurement zones:** draw polygons/spans on the map to measure areas and distances; associate captures with zones.
- **Extra Work Record (EWR):** a separate record type with its own photos, captions, and export, for documenting out-of-scope work and notifications.

---

## 8. Data model

Postgres. Schema is created and migrated idempotently in `db.js` `init()` using `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so deploys are safe to run repeatedly and new columns are added automatically on boot.

**Tables:** `users`, `captures`, `areas`, `user_areas`, `groups`, `group_items`, `capture_pairs`, `measure_zones`, `extra_work_records`, `ewr_photos`, `events`.

Selected `captures` columns of note (there are ~22 added-column migrations):
- Core: `user_id`, `captured_by`, `photo_path`, `photo_width`, `photo_height`, `note`, `latitude`, `longitude`, `address`, `area_tags` (array), `kind` (`note`/`task`), `status`, `created_at`.
- Dimensions (Pro): `dim_length_in`, `dim_length_unit`, `dim_width_in`, `dim_width_unit`, `dim_depth_in`, `dim_shape`, `dim_area_sqft`, `dim_source`, `dim_confidence`, `dim_ai` (JSONB), `dim_confirmed`.
- Defect (Pro): `defect_type`, `defect_severity`, `defect_confidence`, `defect_ai` (JSONB), `defect_user_confirmed`.
- Overlays: `overlays` (JSONB array of stamp/rectangle items).
- Crop: `photo_original_path` (backup of the pre-crop image; null when no crop is active).

`events` is an activity/audit log (`logEvent`) capturing actions like login, rotate, crop, measure, classify, export, etc.

---

## 9. API surface (selected)

Auth/session: `POST /api/login`, `POST /api/logout`, `GET /api/me`, `GET /api/config`, `GET /api/health`.

Captures: `GET/POST /api/captures`, `POST /api/captures/:id` (update, incl. overlays), `POST /api/captures/:id/rotate`, `POST /api/captures/:id/crop`, `POST /api/captures/:id/restore-original`, `GET /api/captures/:id/stamped`, `POST /api/captures/delete`, classification (`/classify`, `/classify-set`, `/classify-batch`), `POST /api/measure`.

Geocoding: `GET /api/geocode` (live preview), `POST /api/regeocode` (backfill addresses).

Topics/areas: `GET/POST /api/areas`, `POST /api/areas/delete`.

Groups: `GET/POST /api/groups`, `GET /api/groups/:id`, add/remove/reorder/delete.

Pairs: `GET/POST /api/pairs`, `GET /api/pairs/suggestions`, `POST /api/pairs/unpair`.

Zones: `GET/POST /api/zones`, `GET /api/zones/:id/defects`, update/delete.

Extra Work Records: `GET/POST /api/ewr`, `GET /api/ewr/:id`, photo add/caption/delete, `GET /api/ewr/:id/export`, delete.

Exports: `GET /api/export/pdf`, `/api/export/docx`, `/api/export/bundle`, `/api/export/proposal`.

Admin: `GET/POST /api/admin/users`, update, password reset; UI at `/admin`.

Note: the crop and restore-original endpoints were added after the local `server.js` snapshot used to generate this list, so confirm the exact set against the live `server.js` in the repo.

---

## 10. Frontend notes

- `app.js` is a hand-rolled SPA. State lives in a single `state` object. Views: Capture, Library (list), Groups, Map (Pro). Handheld devices open to Capture; larger screens open to Library.
- Photo cache-busting uses `state.imgv` appended as `?v=` on image URLs; increment it after rotate/crop so the new image shows.
- The header brand shows `logo.svg` as a CSS background image on `.brand` (the literal text is hidden with `font-size:0` for screen readers). The favicon/app icons come from `icon.svg` (SVG favicon) and generated PNGs.
- Full-screen editors (stamp editor, crop editor) replace `#body`. To return to the Library they must call `renderList()` (which rebuilds the shell), not `loadCards()` alone (which needs the shell to already exist).

---

## 11. Branding

- **Accent color:** blue `#1d4ed8` (buttons, links, selected pills, toasts) via the `--accent` CSS variable. Buttons are intentionally blue.
- **The only red element is the Photo Notes logo.** The header logo is the finalized outlined artwork, all red `#ff0000`, with the wordmark converted to outlined paths (Inter Light 300 / ExtraBold 800). Do not modify that artwork.
- **Brand files in `public/`:** `logo.svg` and `photo-notes-logo.svg` (identical full logo), `icon.svg` and `photo-notes-mark.svg` (identical square mark, used to generate favicons), `zukor-logo.svg` (small "Zukor AI" corner mark).
- **Color reference:** `#ff0000` red (logo), `#1d4ed8` blue (accent/buttons), `#ffffff` white, `#111111` near-black, `#f6f7f9` app background.
- **Formatting preferences (owner):** no em dashes; black body text, never gray; standard fonts (Arial/Helvetica); left-aligned body text.

Note on history: a full red-accent rebrand (red buttons) was prototyped and explicitly rejected. Keep buttons blue.

---

## 12. Service worker / caching

- Cache name is versioned (`efc-shell-vNN`); current is `v25`. **Bump the version whenever a precached shell asset changes** so clients re-precache.
- Fetch strategy is network-first for the shell (tries network, falls back to cache when offline), and network-only for `/api` and `/uploads`. Because of network-first, online users pick up new `app.js`/`send.js`/assets on reload without a version bump; the bump matters for offline correctness.
- After any deploy, tell the user to refresh/reopen the PWA once to pick up changes.

---

## 13. Local development and testing

The app can be run locally against a local Postgres:
1. Start Postgres (any recent version). Create a database.
2. Set `DATABASE_URL`, `SESSION_SECRET`, `PORT`, and optionally the AI/map keys.
3. `npm install` then `node server.js`. Watch for the schema-ready and listening log lines.
4. Seed a user directly in the DB (bcrypt hash) or via the admin seed env vars, since there is no self-registration.

UI was verified during development with Playwright + headless Chromium (screenshots of login, capture, editors). Server-side image work (overlays, crop, stamped renders) was verified by generating real output images and inspecting them. Continue this pattern: after a change, render the actual screen/output and look at it, do not assume.

---

## 14. Known issues, gotchas, and constraints

- **Deploy fragility for big files:** see 3.1. Verify large-file pushes byte-for-byte and confirm the live file parses. A failed push can take the app down.
- **Ephemeral edit container:** see 3.2. Re-fetch live files before editing.
- **Geocoder reachability:** the address lookup depends on external geocoders. If none are reachable or keys are unset, addresses stay blank (coordinates still save). The logic is correct; it just needs a working key/network in production.
- **Deep-editor accents:** a few in-editor accents (crop/stamp selection handles) are still hard-coded blue inside `app.js`. Harmless; sweep them when `app.js` is next edited.
- **`app.js` snapshot drift:** the local `server.js`/`app.js` snapshots used for some tooling can lag production. Trust the live files.
- **Uploads persistence:** ensure `UPLOAD_DIR` is a persistent Railway volume, or photos are lost on redeploy.

---

## 15. Outstanding backlog

1. **Feature 4/5 completion (before/after in group detail + proposal before/after):** this was built and tested twice during development but was lost to container resets before it ever deployed. It needs to be redone and deployed. This is the top outstanding item.
2. **Fold `send.js` behaviors into `app.js`** (Send/Send & Save buttons, corner-logo placement, collapsible Topic area) once a safe large-file deploy path is in place, then retire or slim `send.js`.
3. **Sweep remaining hard-coded blue accents** in the in-editor UI inside `app.js`.
4. **Confirm production env/config:** AI + map + geocoder keys, persistent uploads volume, Pro plan on the primary account.

---

## 16. Quick reference

- Live: https://photonotesapp.com — Repo: `github.com/zukor/photo-notes` (`main`) — Host: Railway (auto-deploy on push).
- Health check: `GET /` → 200, `GET /api/me` → 401 unauthenticated.
- Big files (`server.js`, `app.js`): deploy with extra care and byte-verify. Small files: straightforward.
- Buttons blue, logo red, no em dashes, black text.
- After deploy: refresh the PWA to pick up changes.

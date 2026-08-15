# Elm Creek Field Capture

Standalone, admin-only field-capture web app. Take a photo, add a note (dictate with your phone keyboard), auto-tag location and area, and save it to your own database. Installs to your phone home screen as an app.

## Stack
- Node / Express (single service, serves API + static frontend)
- Postgres (via `pg`)
- Photos on disk (Railway volume in production)
- Single admin login (password + signed cookie)

## Environment variables
- `DATABASE_URL` — Postgres connection string
- `ADMIN_PASSWORD` — the one password that logs in
- `SESSION_SECRET` — long random string for signing the login cookie
- `UPLOAD_DIR` — where photos are written (mount a volume here in prod, e.g. `/data/uploads`)
- `ADMIN_NAME` — display name on captures (default "Sam")
- `PORT` — defaults to 3000

## Run locally
```
npm install
cp .env.example .env   # fill in values
npm start
```

## Milestone 1 (this version)
Login, capture (photo + note + GPS/address + area tag + note/task), review before save, and a filterable list of captures. Data model is Board-Hub-ready for later integration.

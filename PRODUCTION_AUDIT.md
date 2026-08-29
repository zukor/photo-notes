# Photo Notes Production Audit

Audit date: 2026-08-29

## Confirmed

- The public health endpoint responds successfully.
- Production is serving the current cache-busted application assets.
- `NODE_ENV` and a non-empty session secret are configured.
- Database-backed application requests are responding.
- API and upload paths are excluded from the offline shell cache.
- Stripe webhook signature verification and event idempotency exist in code.

## Corrected in code

- Production now refuses to start with a missing, default, or short session secret.
- Security, privacy, framing, transport, and content-policy headers are applied.
- Admin health distinguishes writable photo storage from persistence confirmed across deployments.
- Admin health reports Stripe configuration readiness without revealing secret values.

## Provider configuration still required

- Railway currently has no volume attached to the Photo Notes service. Do not mount a new volume over the existing upload directory until the current photos are copied, because mounting would hide the existing container files.
- Set `UPLOAD_PERSISTENCE_CONFIRMED=true` only after the photo migration and persistent volume are verified.
- AI photo tools are not configured in Railway (`ANTHROPIC_API_KEY`).
- Mapbox and Google Maps keys are not configured; the app uses public ArcGIS/OpenStreetMap address fallbacks and ArcGIS map tiles.
- Issue-report email delivery is not configured (`RESEND_API_KEY`). Reports remain saved in the database.
- Stripe keys, webhook secret, offers, and public base URL are not configured yet.
- Railway should have a database backup/restore policy verified at the database provider. The application repository cannot prove provider-managed backups.

## Safe storage migration sequence

1. Copy the current upload directory out of the running deployment.
2. Create and attach a Railway volume at a new mount path such as `/data/uploads`.
3. Copy the saved uploads into the volume.
4. Set `UPLOAD_DIR=/data/uploads` and deploy.
5. Verify several old photos and one newly uploaded photo.
6. Redeploy once more and verify both old and new photos persist.
7. Set `UPLOAD_PERSISTENCE_CONFIRMED=true`.

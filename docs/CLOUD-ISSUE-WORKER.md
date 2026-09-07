# Cloud issue worker

The Railway web service runs the durable notification worker every two seconds while healthy. It does not depend on Codex desktop. Database events survive restarts, delivery is tracked per subscribed device, retries back off, and expired subscriptions are removed. PostgreSQL advisory locking prevents simultaneous workers delivering the same queue. A crash after push delivery and before acknowledgement can cause a duplicate; the notification tag collapses duplicates on the device.

Users enable notifications in My Issue Reports or Report Issue. Admins enable them through Report Issue and receive issue activity across users. Reporter notifications concern their own reports. Payloads contain no report text, names, or photos. On iPhone, install the web app on the Home Screen first. Browser permission, network availability, and OS delivery policies still apply. In-app attention checks run every five seconds while visible.

## AI repair activation still required

Cloud dispatch is OFF until ISSUE_CLOUD_RUNNER_ENABLED=true and ISSUE_GITHUB_TOKEN exist on Photo Notes Production. Use a fine-grained GitHub credential restricted to zukor/photo-notes with Actions write access. Do not reuse an unrestricted personal login token.

The repository must have OPENAI_API_KEY and TESTER_QUEUE_TOKEN GitHub Actions secrets. The latter is the existing scoped issue queue credential. AI calls consume API usage. No AI credential was found or transferred from another project.

The cloud workflow produces draft repair proposals for a restricted set of frontend files. It has read-only model execution without production or publishing credentials. A fresh job checks patch paths and opens a draft PR. It does not execute proposed code in a credentialed job or mark a report fixed. It does not yet implement automatic testing, review, merge, deployment verification, or exclusive repair claims. Those stages remain necessary before replacing the desktop repair worker. Do not describe proposal generation as automatic repair completion.

Dispatch status and notification worker timestamps are shown in Admin. A successful GitHub dispatch only acknowledges workflow scheduling, not AI completion. Failed or unavailable dispatch credentials are stored as dispatch errors. Keep the existing desktop repair automation active until the full cloud pipeline has been validated.

No real reports were submitted and no devices were subscribed on behalf of users during deployment tests.

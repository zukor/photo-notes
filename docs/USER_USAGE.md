# User Usage

Open https://photonotesapp.com/admin?view=super and use User Usage.
Choose Last 24 hours, 7 days, 30 days, or 90 days. Select all users or one user and refresh.

The dashboard shows successful logins, browser sessions, estimated active minutes, screen visits by edition, recorded feature action counts, and recent activity. Sessions show first and last observation within the selected rolling period. Session rows and recent activity each show the latest 100 entries. Screen and action breakdowns are capped at 1,000 groups.

Active time measures visible use, pauses after one minute without interaction, and excludes hidden tabs. It is an estimate, not elapsed time between login and logout. Simultaneous tabs can contribute separately. Pulses send every 30 seconds and on navigation or hiding; interrupted connections can lose usage observations. The application continues working if tracking fails.

Successful sign-ins and existing recorded service operations remain available for earlier dates. Screen visits, session observations, and active time start with this release. Feature action counts use existing server event records and do not represent every button click. Tracking never reads or stores field values, photo content, or note text. The dashboard only exposes operation names and timestamps.

Only Super Admin can read the dashboard, including its API. Regular Admin view is denied. Pulse identity comes from the authenticated server session, and payloads contain only bounded screen, edition, session, visit, and time values. Existing user deletion removes the associated events.

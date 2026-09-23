# Super Admin access

`SUPER_ADMIN_USER_IDS` is a comma-separated list of existing user IDs in the server deployment environment. Each listed account must also be active and have the `admin` role. An empty or missing list grants nobody Super Admin access. Membership is evaluated from the current database account on each request, not from a role claim in an old session token.

Only Super Admin accounts can access System Health, Stripe Invoicing, Administrative Activity Log, and repair System status. The shared `/api/admin` middleware enforces these restrictions before route handlers run. Existing ordinary admin tools remain available.

All admin routes targeting a configured Super Admin account, including edits, password resets, version access and deletion, are denied to other accounts. The normal user editor cannot assign Super Admin membership. To grant it, an authorized deployment operator must verify the user's identity and ID, update `SUPER_ADMIN_USER_IDS`, and deploy. Never configure IDs from an unverified request.

Production initially grants membership only to Samuel Turcotte's verified existing account. No user database migration is needed. Browser checks: `node scripts/test-super-admin.cjs`. Server authorization tests: `node --test test/super-admin.test.js`.

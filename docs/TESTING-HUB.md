# Testing Hub

Account menu > Manage Testing is available to admins and designated testing
managers. Admin > Testing Assignments opens the same shared workspace. It manages bilingual drafts, account selection, preview,
publication, individual results, review notes, and requests to retest. Published
instructions are frozen. Copy an assignment to create a new round.

Testers use their existing login and the upper-right account menu > Testing Hub
in every edition. Each tester has a separate assignment with Passed, Failed,
Blocked, and Not Tested results, notes, private photo evidence, linked issue
reports, and English or Spanish PDF downloads. Results save automatically.
Failures and incomplete testing can be submitted with explanations.

Publication checks that each selected active account already has access to the
edition. It marks those accounts as testers but does not grant edition access.
New assignments and retest requests appear in the in-app attention indicator.
No assignment emails are sent by this feature.

The initial Road Issue Reporter assignment is seeded once as a draft. Jose and
Gaby/Gabby are suggested only when their first names identify unique active
accounts. Review the selected names and email addresses before publishing.

Admins can grant or revoke Testing manager under a user's Testing access.
Managers can manage all assignments and review evidence, history, and downloads.
They receive only the tester selection roster, without account administration,
billing, password reset, or version-access controls. Permission is checked from
the current account on every request, so revocation takes effect immediately.

## Data and recovery

Schema changes are additive. Existing checkmarks remain completion records and
are never counted as passed results. New assignments use per-step JSON results.
Submission snapshots preserve prior rounds when an admin requests a retest.
Concurrent changes are protected by revision checks and row locks. Unsaved text
is retained in account-scoped browser storage; conflicting drafts can be
downloaded for comparison. Photos must finish uploading before submission.

Evidence is stored as resized JPEG data in PostgreSQL, accessible only to the
assigned tester and admins. Issue links require ownership of the assignment and
a valid step. Idea report categories retain their existing review workflow.

## Verification

- `npm test`: standard unit and regression suite.
- `PN_TESTING_HUB_DB=postgresql://postgres@127.0.0.1:55474/pn_testing_hub node --test test/testing-hub-integration.test.js`:
  opt-in disposable database test, never point it at production. Use a fresh
  database each time. Tests publication, ownership, conflicts, photos, linked
  reports, PDF access, incomplete submissions, and retest history.
- `node scripts/test-testing-hub-browser.cjs`: requires the synthetic integration
  accounts on a local server at port 3109 with their assignments reopened. Tests
  English and Spanish phone layouts, saving and recovery, photo uploads, issue
  context, submission, admin preview, and retest review.

Browser emulation does not replace testing on physical phones.

# Phase 2 QA and release report — 24 November 2026

This report supersedes the Phase 1 readiness conclusions. Historical financial fixtures and original fixes are retained in QA_REPORT_PHASE1.md. Work was performed in the existing source directory with the original AppDeploy HTML/TypeScript/CSS architecture. No React/framework rewrite or hosted deployment change was made. coparent_db was inspected only with doctor; all test writes and destructive cleanup used a separate disposable PostgreSQL instance/database and generated schemas. The existing .env was not rewritten.

## Implemented work

| Area | Completed behavior | Main files |
|---|---|---|
| Email verification | New accounts unverified; 256-bit one-use tokens, SHA-256 hashes only, 24-hour expiry, recipient/account binding, resend invalidation and limits. Verified email/legacy exception enforced for invitations and sensitive account endpoints. | server/accounts.cjs, server/schema.sql, src/account-ui.ts |
| Signup privacy | Same generic 201 response for new/duplicate email; no signup session or token disclosure; sign in separately; draft-policy acknowledgment recorded. | server/accounts.cjs, src/app-client.ts, src/policies.ts |
| Recovery | Forgot-password UI, generic known/unknown response, 30-minute hash-only tokens, password policy, locked single-use reset, other reset-token invalidation and session revocation; concurrent reset yields one success. | server/accounts.cjs, src/app-client.ts, src/account-ui.ts |
| Email adapter | Configurable server-side Resend API with timeout/idempotency header, private opt-in development filesystem sink, no public inbox endpoint, no raw-token logs/API fields. Production rejects development sink/missing sender configuration. | server/mail.cjs, .env.example |
| Account export | Authenticated verified/legacy export of account/profile/membership/authorized shared ledger/created entries/notification read states/request metadata, timestamp and schema version; no hashes, sessions or invitation secrets. | server/accounts.cjs, src/account-ui.ts |
| Deletion | Password-confirmed idempotent request; legal hold and approved retention review; operator completion disables/anonymizes account, removes personal profile/read/token data, revokes sessions, anonymizes recipient invitation addresses and preserves financial history. Both owner/member closures archive the current ledger for surviving authorized access. | server/deletion.cjs, scripts/complete-deletion.cjs, src/account-ui.ts, src/main.ts |
| Draft product policies | Accessible Privacy, Terms, Retention/Deletion, Help/Support and Security pages, linked from auth/account settings. Draft status and missing business details clearly identified; official support route configurable. | src/policies.ts, docs/POLICY_OWNER_CHECKLIST.md |
| Security/operations | Async versioned scrypt, legacy hash compatibility, database-backed multi-process rate counters, dummy derivation work for unknown accounts, account locks around sensitive writes, redacted request IDs/errors, explicit dotfile rejection, bounded HTTP timeouts and configuration validation. Original origin/CSRF/financial ownership controls retained. | server/security.cjs, server/index.cjs, server/database.cjs, server/env.cjs |
| Migration | Additive columns/tables/indexes, pinned connection/transaction/advisory lock; existing accounts/sessions remain compatible without falsely marking emails verified. New inserts default to verification-required. | server/schema.sql, scripts/migrate.cjs |
| Backups | Preserved backup command, unique custom-format dumps with safe status logs, password out of argv, disposable-only restore validation with table counts/exact row digests, scheduler wrapper and recovery/rollback instructions. | scripts/backup.cjs, scripts/validate-restore.cjs, ops/backup-task.ps1 |
| UI preservation | Existing sidebar, logo, mobile navigation, dashboard and financial design retained. New account panels reuse existing classes. Settings toolbar wraps at 320px; archived UI clearly read-only. | src/main.ts, src/account.css, src/account-ui.ts |

Additional changed/added files: tests/accounts.cjs, tests/security.test.cjs, tests/mail-helper.cjs, tests/integration.cjs, tests/browser.cjs, tests/e2e.cjs, scripts/benchmark-auth.cjs, scripts/package-release.py, package.json, README.md, docs/PRODUCTION_RUNBOOK.md, docs/LAUNCH_GATES.md, docs/SOURCE_PROVENANCE.md and this report. The lockfile/runtime dependency set is unchanged. Compiled dist was rebuilt. Original ledger.cjs financial rules, brand SVG and core visual stylesheet are retained.

## Executed validation

| Command/check | Result | Actual evidence |
|---|---|---|
| npm.cmd ci | PASS | Clean lockfile install, 54 packages; no new runtime dependency |
| npm.cmd run doctor | PASS | PostgreSQL 18.6 / coparent_db / coparent_user connection and schema inspection only |
| npm.cmd test | PASS | 14 tests: original 10 plus async/legacy password compatibility, policy bounds, production email safety and mocked Resend contract |
| .\node_modules\.bin\tsc.cmd --noEmit | PASS | No diagnostics |
| npm.cmd run build | PASS | Vite 6.4.6; nine modules, compiled HTML/CSS/JS |
| npm.cmd run test:accounts | PASS | 24 scenario subtests plus parent = 25 Node results, actual isolated PostgreSQL |
| npm.cmd run test:integration | PASS | Existing 23 scenario subtests plus parent = 24 Node results; FIN-01 through FIN-20 retained |
| npm.cmd run test:browser | PASS | 213 checks; original 107 plus 104 account/policy/verification/reset width cases and 2 archival checks |
| npm.cmd run test:e2e | PASS | Original 18 plus 11 account/policy/recovery checks = 29 real-browser/API/PostgreSQL checks |
| npm.cmd start + HTTP smoke | PASS | QA database, port 3106: readiness/HTML and 2 compiled JS/CSS assets with MIME checks; /.env explicitly 404 |
| Production-mode API worker | PASS (local configuration) | HTTPS canonical origin, Secure/HttpOnly/SameSite login cookie, HSTS; dev/unapproved origins rejected; spoofed forwarding header cannot downgrade. Provider call mocked. |
| npm.cmd run backup | PASS | Actual PGDMP custom-format dump, safe success log, nonempty QA data |
| npm.cmd run backup:validate | PASS | 15 cp_* tables across public/generated QA schemas: counts and sorted row digests exactly matched after restore into newly-created database; disposable target removed |
| Actual PostgreSQL restart | PASS | Disposable server stopped/restarted; nonempty $100 expense/$20 reimbursement state exactly unchanged and $30 outstanding; own probe schema removed |
| npm.cmd run benchmark:auth | PASS (synthetic measurement) | At final stronger scrypt parameters, 8 synchronous hashes: 2568 ms elapsed/heartbeat gap; async: 867 ms elapsed, max heartbeat gap 17 ms. Not a host-capacity certification. |
| npm.cmd audit --json --fetch-retries=0 --fetch-timeout=10000 | NOT VERIFIED | Registry advisory request failed due sandbox network access; no clean online audit is claimed |
| Actual email, production TLS/proxy/DB TLS/cloud recovery | NOT TESTED | No service credentials, approved sender or hosting environment supplied |

All destructive tests were confined to coparent_qa on a separate loopback PostgreSQL 18.6 instance at port 55439 under ignored artifacts/pgqa. Account/financial suites create unique schemas and clean their own data. No test account was inserted into coparent_db. Mail sink files, dumps, QA cluster and screenshots are excluded from the release ZIP.

## Account-security scenarios exercised

- Verification: valid, invalid, expired, reused, wrong signed-in account and wrong token/account email; verified account cannot be reverified; resend invalidates old token and rate limits.
- Migration: simulated Phase 1 table/account/session, then full additive migration; legacy access flag retained, verified timestamp remains null, session survives. No old financial reset.
- Password reset: known/unknown generic response, invalid/expired/reused token, weak replacement rejected, fresh request invalidates older reset tokens, concurrent attempts yield one success, old password rejected, new password accepted and all earlier sessions revoked.
- Abuse: real token-submission throttling, unknown-email request throttling, shared database limiter instances and expiry reset.
- Account export: unauthorized 401, unverified 403, scoped own/shared data, no hashes/cookies/recovery secrets, unrelated parent receives no shared ledger.
- Deletion: password and confirmation required, client-supplied other-user ID ignored, repeat request stable, account stays active while pending, legal hold prevents completion, member and owner completion tested, sessions revoked, recipient invitation address anonymized, exact paid ledger retained, survivor export and archived write rejection verified.
- UI: signup acknowledgment, real verification link/button, forgot/reset flow, fragment token removed from URL, successful new-password login, invalid link state, personal export download, deletion-request confirmation/reference and all five draft pages.

The original financial assertions remain: correct 50/50 and 70/30 cents, boundary shares, $20/$30 reimbursement sequence, overpayment rejection, $35/$50 gross obligations with optional $15 difference and no auto-payment, $10.01 cent allocation, invalid amount/splits, duplicate IDs/stale revision rejection, concurrent update conflict, paid-history edit/delete protection, restart persistence and report/API/database reconciliation. Original QA-001–004 fixes remain covered.

## Responsive and visual evidence

All 13 widths passed: 320, 360, 375, 390, 414, 430, 600, 768, 820, 1024, 1280, 1440 and 1920 CSS px. Original 7 financial/settings views plus 8 Phase 2 routes were checked for document overflow, with long names, 99 unread count and large pending amount. Escape/focus restoration, labels, download, print/PDF generation, landscape and a reduced viewport equivalent to 200% layout zoom remain covered. Screenshots were inspected at artifacts/phase2-account-360.png, artifacts/phase2-privacy-1440.png and prior dashboard/print captures. Temporary screenshots are available locally but intentionally not bundled.

The responsive suite uses isolated API fixtures. E2E uses actual Node/PostgreSQL and separate browser contexts; only the external font stylesheet is stubbed. Screen-reader certification, native browser-chrome zoom, real mobile hardware, all browser engines, physical printer dialogs and live hosted pixel comparison remain unverified. Original Google Font delivery is blocked by this sandbox, not silently marked successful.

## Remaining prerequisites and limits

| Priority | Exact remaining item |
|---|---|
| P1 | Owner/legal approval of actual controller identity, official support route, jurisdiction, privacy/terms, retention/legal-hold/backup periods and recovery/deletion responsibilities. Product pages remain visibly DRAFT. |
| P1 | Real Resend verified sender/domain, private key configuration and end-to-end delivery/spam/recovery tests. Local sink and mocked API are not delivery evidence. |
| P1 | Actual host HTTPS/reverse proxy, managed DB certificate verification/runtime least privilege, monitoring/incident ownership, encrypted off-host backups/PITR and approved recovery RPO/RTO. No external environment was deployed. |
| P1 | Current online advisory audit, independent security review and actual-host load/resource-exhaustion tests; choose/test exact supported Node LTS and hosting memory/threadpool capacity. |
| P1 for paid access | Approved commercial terms, support/refund commitments and a billing/access-entitlement model if charging users. No payment processor or billing system was added. |
| P2 | Best-effort in-process account-email dispatch can require resend after a crash; there is no durable retry/outbox worker. Verify alerts and user-support handling before broad exposure. |
| P2 | Shared financial text/attribution and approved audit metadata remain after account closure; backups/browser/downloaded copies are not remotely erased. Operator workflow must be staffed and reviewed. Archival does not transfer ownership or create a new workspace. |
| P2 | Legacy accounts retain a documented verification exception and older password work factors until reset; owner must approve their rollout policy. JSONB financial invariants still depend on trusted API transactions. |
| P2/P3 | Font availability, actual mobile/accessibility/native print checks and approved expired-session/token/rate-counter cleanup schedule remain operational work. |

No confirmed P0 was found in the executed scope. This is not a penetration-test or legal-compliance certification. The original hosted deployment and real customer data were not accessed for writes.

## Release verdict

| Stage | Verdict | Evidence/condition |
|---|---|---|
| READY FOR LOCAL DEVELOPMENT | YES | Clean install, types, build, actual database/account/financial suites and real-browser workflows pass; enable only the private dev mail sink for local delivery |
| READY FOR PRIVATE STAGING | CONDITIONAL | Restricted disposable testers; configure/test actual HTTPS/origin/DB permissions/email and backup/monitoring operations first |
| READY FOR PRIVATE BETA | CONDITIONAL | Before real family data: finalized approved policies/support, staffed deletion/recovery process and actual-host/email/recovery/security checks required |
| READY FOR PUBLIC FREE LAUNCH | NO | External operational, approved-policy, delivery and security gates remain |
| READY FOR PAID COMMERCIAL LAUNCH | NO | Public gates plus commercial/billing/support decisions remain |

See PRODUCTION_RUNBOOK.md for exact PowerShell setup, migration, provider, deletion, backup/scheduling, deployment and rollback instructions. Release archive: CoParent_Expense_Manager_Phase2_Production_Preparation.zip. It includes source/config/schema/tests/docs/compiled dist, and excludes .env, dependencies, dumps, test records, mail messages and temporary QA artifacts.

Parameter/reference checks: [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) lists the chosen N=32768/r=8/p=3 scrypt option; [Node crypto](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback) documents its async API. These references informed the implementation; they do not certify the application.

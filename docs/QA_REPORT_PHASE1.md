# CoParent Expense Manager — QA completion report

Audit date: 24 November 2026 (Asia/Karachi). Work performed in the existing project. Original visual identity and historical AppDeploy backend retained. No hosted deployment or existing customer ledger was modified. This replaces the earlier unexecuted launch checklist; it does not certify an untested hosting environment.

**READY FOR PRIVATE STAGING: CONDITIONAL**

**READY FOR PAID PUBLIC LAUNCH: NO**

## Fixes and root causes

| Issue | Status | Root cause and solution | Files |
|---|---|---|---|
| QA-001 P2 Settings accessible names | FIXED / browser PASS | Visible sign-in label was unassociated; invitation/file controls lacked explicit labels. Added unique profileEmail/invitationEmail IDs and matching labels; importfile receives a screen-reader label. Existing profileName/profileColor associations verified. | src/main.ts |
| QA-002 P2 narrow-phone overflow | FIXED / browser PASS | Under 370px shell padding was 11px but flush header expansion used a larger CSS gutter. Use the same 11px gutter. Removed pre-existing body overflow-x:clip. Unbroken 50-character parent names additionally overflowed card labels, report flex rows, form labels and desktop table cells; targeted min-width/wrapping fixes address their actual content sizing. Money/headings stay intact; wide tables use a focusable local scroll region. | src/styles.css |
| QA-003 P2 notification Escape | FIXED / browser PASS | No notification Escape handler; rendering replaced the focused bell. Escape closes from bell/panel and focuses the new bell. Opening also restores bell focus; aria-expanded derives from noticeOpen. No focus trap added. | src/main.ts |
| QA-004 P3 profile reset wording | FIXED / browser PASS | Button had been renamed while paragraph/dialog/success copy still described deletion. All now use Reset Display Profile and explain preserved login, membership and financial records. | src/main.ts |
| E-01 rejected alternate origin | EXPECTED / API PASS | PUBLIC_ORIGIN approves localhost, not 127.0.0.1. Approved signup succeeds; alternate/unapproved origins return 403. Production rejects Vite development origins. No wildcard added. | server/index.cjs, .env.example |
| Cent-level consistency | FIXED / automated PASS | Frontend computed percentage before allocating integer cents; multiplication could differ from backend. Both allocate integer total cents using percentage basis points. Backend rejects split precision beyond 0.01%, invalid cent amounts and normalized invalid dates such as February 30. | src/main.ts, server/ledger.cjs |
| Duplicate UI submissions | FIXED | Expense/payment forms guard an in-flight submission and disable submit before saving. UUIDs replace millisecond-only IDs. Backend duplicate IDs/revision conflicts prevent duplicate financial writes. A stale retry returns conflict rather than replaying a success response. | src/main.ts |
| Membership race | FIXED / concurrent API PASS | Separate owner/member unique columns alone could allow create and join to race. Both paths lock the account row in their transaction. Membership changes also increment ledger revision so stale writes conflict. | server/index.cjs |
| Polling and profile cache | FIXED | Notification-only changes now replace only header tools instead of rebuilding unsaved forms. Settings excluded from automatic ledger rerender. Successful authoritative profile lookup clears stale customization cache after reset. Failed expense deletion no longer reinstates stale records over a reloaded workspace. | src/main.ts |
| Production lifecycle/configuration | IMPROVED / local configuration PASS | Require HTTPS production origin, emit HSTS, bound login passwords, redact unexpected error details, handle idle pool errors, close HTTP/pool on signals, and separate production migrations from runtime startup. | server/index.cjs, scripts/migrate.cjs |
| Asset CSP | FIXED; external delivery NOT TESTED | Existing Google Font import was blocked by self-only CSP. Permit only fonts.googleapis.com stylesheets and fonts.gstatic.com font files. Outbound sandbox network denies actual download, so font delivery remains unverified; browser tests explicitly stub the external stylesheet and use fallback fonts. | server/index.cjs |
| Database/backup operations | IMPROVED / local recovery PASS | Added session-expiry/invitation-workspace indexes. Migration command applies additive schema in a transaction. pg_dump password moved from command-line URL into child environment. Updated ignores exclude dumps/env variants/artifacts. | server/schema.sql, scripts/backup.cjs, .gitignore |

Other changed/added files: package.json (test/migration scripts), README.md, .env.example, docs/SOURCE_PROVENANCE.md, docs/LAUNCH_GATES.md, docs/PRODUCTION_RUNBOOK.md, this report, tests/qa-regression.test.cjs, tests/integration.cjs, tests/browser.cjs, tests/e2e.cjs, scripts/package-release.py. package-lock.json dependencies remain unchanged. Dist was rebuilt, not treated as the source of truth.

## Executed commands and results

| Command/check | Result | Evidence/count |
|---|---|---|
| npm.cmd ci | PASS | 54 packages installed from existing lockfile |
| npm.cmd run doctor | PASS | Existing configured server: PostgreSQL 18.6, coparent_db, coparent_user; connection/schema inspection only |
| npm.cmd test | PASS | 10 unit/source/regression tests |
| .\node_modules\.bin\tsc.cmd --noEmit | PASS | No diagnostics |
| npm.cmd run test:integration | PASS | 23 scenario subtests plus parent = 24 Node test results; actual PostgreSQL 18.6 |
| npm.cmd run test:browser | PASS | 107 browser checks; 91 page/width combinations, labels, keyboard, download, report, PDF, landscape and reduced layout viewport |
| npm.cmd run test:e2e | PASS | 18 real-browser workflow checks through Node/PostgreSQL; only external font stylesheet stubbed |
| npm.cmd run build | PASS | Vite 6.4.6, six modules, CSS/JS emitted; no unavailable Tailwind/PostCSS config |
| npm.cmd start | PASS | Separate QA DB on port 3096; /api/health returns ok:true and PostgreSQL, / returns HTTP 200 |
| npm.cmd audit --offline --json | LIMITED | Returned zero vulnerabilities from available local metadata; not a current online advisory audit |
| Fresh server processes | PASS | Two independent Node processes read identical ledger/session after restart |
| pg_dump/pg_restore | PASS | Actual custom-format dump restored into uniquely named separate QA database; state reconciled; disposable restore DB removed |
| Production-mode config worker | PASS | HTTPS origin accepted; Secure/HttpOnly/SameSite cookie and HSTS; spoofed X-Forwarded-Proto cannot downgrade; dev origin denied |
| Original hosted visual reference | NOT TESTED | URL retrieval unavailable; no authenticated hosted records accessed |
| Online Playwright installation | BLOCKED BY NETWORK | Used existing cached Playwright instead; no project dependency upgrade or runtime dependency added |

The primary integration instance was independent of the owner's PostgreSQL service: new disposable data directory under ignored artifacts/pgqa, loopback 55439, database coparent_qa. Test schemas/accounts are generated uniquely and removed by the suites. Test artifacts and data directories are excluded from the source ZIP. The administrator-created coparent_qa on the owner's service was not needed or written by these tests.

## Functional scenarios

| # | Scenario | Status and evidence |
|---|---|---|
| 1 | Signup/login/logout | PASS — API valid/wrong credentials and real UI login cycle |
| 2 | Session persistence/expiry | PASS — cookie/session across requests and fresh processes; DB-controlled expired session returns null |
| 3 | Password handling | PASS — weak signup rejected, salted scrypt hash format inspected, successful and incorrect login exercised; no plaintext hash storage |
| 4 | Workspace creation | PASS — API and UI; concurrent membership race admits one workspace only |
| 5 | A invitation generation | PASS — real Settings form and API |
| 6 | B acceptance | PASS — matching invited email joins shared workspace in separate browser context |
| 7 | Expired/invalid/reused invitations | PASS — explicit rejection; wrong recipient 403 |
| 8 | C isolation | PASS — independent workspace API and UI cannot see A/B expenses or notifications |
| 9 | Dashboard/empty states | PASS — UI initially empty then real amounts appear |
| 10 | Add expense | PASS — real form persisted to PostgreSQL |
| 11 | Edit expense | PASS — real form and backend ownership rejection |
| 12 | Delete expense | PASS — API deletes unpaid owned expense; shared/paid deletion rejected; full delete-button workflow not executed |
| 13 | Category/date/split validation | PASS — API rejects missing category, February 30, malformed amount/splits; UI category selection retained; categories remain nonempty text (legacy/custom categories supported) |
| 14 | Partial reimbursements | PASS — real UI $20 receipt on $50 obligation, $30 outstanding |
| 15 | Full reimbursements | PASS — integration records final $30; balance settles |
| 16 | Overpayment | PASS — API rejects $31 when $30 remains |
| 17 | Payment history | PASS — immutable backend history and actual Payments page $20 entry |
| 18 | Pending expenses | PASS — API pending counts/amounts and pending header; dedicated pending-list interaction not separately exercised |
| 19 | Incoming/outgoing balances | PASS — exact gross obligations, including FIN-09 $35/$50 |
| 20 | Notifications between parents | PASS — B receives A's expense via real API/UI; unrelated C does not; exact 30-second polling latency not timed |
| 21 | Notification read persistence | PASS — mark read, reload, unread badge absent; API confirms |
| 22 | Profile customization/reset | PASS — real UI saves and resets; API verifies ledger/membership unchanged |
| 23 | Report totals | PASS — real UI $100 expense/$20 payment/$30 remaining reconcile with PostgreSQL; cent fixture also checked |
| 24 | Print/Save PDF | PASS (automated) — print media and Chromium PDF output generated; physical printer/native OS save dialog not tested |
| 25 | Backup export | PASS — downloaded JSON matches actual database ledger |
| 26 | Backup import validation | PASS — broken JSON displays error; unmodified backup reimport succeeds; malformed/unauthorized financial state rejected server-side |
| 27 | Persistence after restart | PASS — independent processes read identical state and session |
| 28 | Access removal/permissions | PASS — member loses workspace and notification access; create/join race serialized; direct database bypass is outside supported API trust boundary |

## Financial release cases

| ID | Result | Evidence |
|---|---|---|
| FIN-01 | PASS | $100 paid A, 50% share -> $50 B obligation |
| FIN-02 | PASS | $200 paid A, 70% share -> $60 B obligation |
| FIN-03 | PASS | $100 paid B, 70% A share -> $70 A obligation |
| FIN-04 | PASS | 100% A share -> zero B obligation |
| FIN-05 | PASS | 0% A share -> $100 B obligation |
| FIN-06 | PASS | $20 payment reduces original $50 obligation to $30 |
| FIN-07 | PASS | Additional $30 fully settles original obligation |
| FIN-08 | PASS | $31 attempted with $30 remaining -> 400 |
| FIN-09 | PASS | Separate paired workspace retains $35/$50 gross values; $15 difference; no automatic payments |
| FIN-10 | PASS | $10.01 split rounds A to $5.01/B to $5.00; backend + browser report checked |
| FIN-11 | PASS | Zero/negative amounts rejected |
| FIN-12 | PASS | Out-of-range split rejected; at most 0.01% precision |
| FIN-13 | PASS | Duplicate expense ID rejected; retry at old revision conflicts |
| FIN-14 | PASS | Duplicate payment ID rejected; retry at old revision conflicts |
| FIN-15 | PASS | Concurrent same-revision writes -> exactly one success, one 409 |
| FIN-16 | PASS | Overpayment rejected at locked transaction boundary |
| FIN-17 | PASS | Description edit retains paid history; reducing owed below paid rejected |
| FIN-18 | PASS | Linked expense deletion and reimbursement removal rejected |
| FIN-19 | PASS | Actual fresh process reads persisted ledger/session twice |
| FIN-20 | PASS | API state equals database; integer-cent summaries match; real browser report reconciles $100/$20/$30 |

Financial state is validated on the server before commit while holding a workspace row lock. Cents are exact integers within the bounded amounts. There is no automatic mutual offset. Idempotency is rejection-based (unique entry IDs and optimistic revision), not a replay cache: a client must reload after a conflict and must not retry with new IDs automatically.

## Responsive/accessibility scope

All requested widths passed unintended document-level horizontal-scroll checks: 320, 360, 375, 390, 414, 430, 600, 768, 820, 1024, 1280, 1440, 1920 CSS px. Pages covered: dashboard, expenses, payments, report, settings, expense form and payment form. Stress fixture uses 50-character unbroken names, 99 unread badge and a large pending amount. Screenshots available under ignored artifacts/. The application retains the premium sidebar, tablet rail and mobile bottom navigation.

Escape tested with bell focus and panel control focus; focus returns to bell and aria-expanded becomes false. Enter and mouse interactions tested. Five Settings controls have associated label elements. Sign-out icon gains an accessible name on small screens. Landscape 740x360 and a 640x450 layout equivalent to a 1280px display at 200% zoom were checked. Actual browser chrome zoom, screen readers, Safari/Firefox/mobile hardware and every modal at every width were NOT TESTED. Focus indicators were retained; no exhaustive WCAG certification is claimed. Google Fonts were unavailable in this sandbox and were explicitly stubbed for deterministic layout testing.

## Remaining issues and hosting decisions

| Priority | Unresolved item / limitation |
|---|---|
| P1 | Email verification and self-service password recovery are absent. Establish and verify an invitation/account onboarding and recovery process before public use. |
| P1 | Complete account deletion/export, retention rules, privacy notice, terms/support and incident procedures are absent. Workspace export and display reset do not fulfill account deletion. |
| P1 | Actual host HTTPS/reverse proxy, managed PostgreSQL certificate validation, least-privilege runtime grants, monitoring, secret management, distributed/perimeter throttling and off-host backups/recovery have not been deployed or verified. |
| P1 | No load/resource-exhaustion testing, fresh online vulnerability audit or independent penetration test. Authentication hashing is synchronous; per-process throttling and shared proxy IP behavior need capacity/abuse validation. |
| P2 | Google Font availability and visual comparison to hosted original remain unverified. CSP now permits its exact required hosts; production font resources must be tested. |
| P2 | JSONB financial invariants and cross-column membership exclusivity depend on trusted application code/transaction protocol; no normalized ledger foreign keys or direct-SQL monetary constraint exists. Never expose runtime credentials to end users. |
| P2 | Backup import/reset cannot erase immutable payment history or alter another parent's financial entries. Preserve this protection; improve Settings explanations if offering general restore/deletion workflows. |
| P2 | Actual LTS runtime, OS-level zoom, mobile hardware, screen reader review, native print/save dialogs and actual hosting shutdown behavior remain unverified. |
| P3 | Expired-session retention cleanup, session management UI and bounded ledger growth (500 expenses/1000 payments) require an operational/product policy. No major features were added. |

| Stage | Decision |
|---|---|
| Local development | YES — inspected build, real PostgreSQL/API and browser workflows pass within documented scope |
| Private staging | CONDITIONAL — restricted testers/disposable data, HTTPS/secrets/DB role/TLS/backup/proxy smoke checks required |
| Private beta with real family data | NO — resolve privacy/deletion/recovery and operational gates first |
| Public free launch | NO — public authentication/operations/security gates remain |
| Paid commercial launch | NO — all public gates plus billing/support/legal launch requirements remain |

The ZIP is a sanitized source/buildable-project handoff, not a customer database backup or a hosted release. See PRODUCTION_RUNBOOK.md for setup, migration, testing, deployment, backup/restore and rollback commands.

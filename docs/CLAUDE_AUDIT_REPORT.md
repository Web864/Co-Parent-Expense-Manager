# Claude audit report: CoParent Expense Manager (25 November 2026)

Baseline commit `72c975e`. Work was done in the existing repository; no framework change, no schema change, no push, no deployment. The original financial rules (`server/ledger.cjs`), AppDeploy styling and branding were not modified.

## Executive summary

The codebase is in better shape than a typical pre-launch app: ledger rules, ownership checks, origin checks, hashed single-use tokens, database-backed rate limits and a restore-validation tool all exist and passed fresh test runs. No P0 defect (data loss, financial corruption, auth bypass) was found.

**Why password-reset mail never reaches Gmail:** this is configuration, not a code bug. With `EMAIL_PROVIDER=development` the server only writes JSON files to a local sink and never contacts any mail service. Real delivery needs `EMAIL_PROVIDER=resend`, a `RESEND_API_KEY` and an `EMAIL_FROM` on a Resend-verified domain. None of these were available, so **real email delivery was NOT tested.** The blank link in the redacted sample is not treated as a defect.

Fixes made: proxy-safe rate limiting, diagnosable mail failures, honest development-mode messaging, production sender validation, expired-row cleanup, and two small robustness/encoding fixes.

## Issues found and actions

| ID | Priority | Issue | Action | Verification |
|---|---|---|---|---|
| A-01 | P1 | Rate limits key on `socket.remoteAddress`. Behind any reverse proxy all users share one bucket (default 18 attempts per 15 min), so normal traffic can lock everyone out of login/signup/reset. | Added opt-in `TRUST_PROXY` (last `X-Forwarded-For` entry; off by default). | Real server run: header ignored when off; when on, distinct clients independent and a spoofed first entry does not evade the limit. Ad hoc script, not part of the repo suite. |
| A-02 | P2 | Provider failures were swallowed (`Email provider rejected message.`, then a generic log line) with no status or reason, so a wrong key or unverified domain was undiagnosable. | Mailer now records HTTP status and Resend error name, plus timeout/network reason; new `mail_delivery_failed` log event for verify, reset and invite mail. | New unit test: key, recipient, link and provider message text never appear in the log. |
| A-03 | P2 | Production only checked that `EMAIL_FROM` was non-empty; the `.env.example` placeholder would start fine and then fail on every send. | Production now rejects malformed and `example.com/org/net` senders at startup. | New unit test. |
| A-04 | P2 | Signup/forgot/resend responses said "check your inbox" even when development sink mode was active; invite UI said "accepted by the delivery provider". | Development mode appends a clear notice (constant per deployment, so no account enumeration). Invite text now says "accepted for sending, delivery not guaranteed". | Verified in live API response; browser suite 213/213 and e2e 29/29 still pass. |
| A-05 | P2 | Expired sessions, rate-limit counters and action tokens were never purged. | New `npm run maintenance:cleanup` (with `--dry-run`); documented in runbook. | Seeded schema: deleted only expired rows; live rows and users untouched. |
| A-06 | P3 | Garbled byte (Windows-1252 en dash) in two user/operator messages; files were not valid UTF-8. | Replaced with ASCII text, encoding otherwise preserved. | Accounts suite passes. |
| A-07 | P3 | Requesting a directory under `dist` (for example `/assets`) returned a 500 (confirmed). | Static handler now 404s anything that is not a regular file. | Live request to `/assets`: 500 before, 404 after; `/` still 200. |

## Remaining issues (not fixed)

- **P2:** Account emails are sent fire-and-forget after the response, with no durable outbox or automatic retry. A provider outage means the user must use the rate-limited resend. Needs a product decision (queue or job table).
- **P3:** Login is limited per email as well as per IP, so someone can deliberately trigger lockouts for a known address (15-minute window). Standard trade-off; consider CAPTCHA or progressive delay.
- **P3:** Sessions are fixed 30-day with no idle timeout or rotation; cookie is not `__Host-` prefixed; HSTS has no `includeSubDomains`/preload. Acceptable for private beta.
- **P3:** CSP allows Google Fonts. Font delivery under CSP was stubbed in tests and is NOT TESTED against the real service; self-hosting the fonts would remove the external dependency.
- **Note:** the shared ledger is one JSONB document per workspace, capped at 500 expenses and 1000 payments. Fine for the current scope; revisit before heavy use.

## Test evidence (re-run this session)

Environment: Node 22.23.5, **PostgreSQL 16.15** on a throwaway local cluster (project targets 18.6, so version-specific behaviour is not verified), QA database `coparent_qa` distinct from the app database. A first integration run showed 6 failures because the sandbox database server crashed mid-run (its data directory became unreadable); the rerun on a stable cluster passed with no code change.

| Check | Result |
|---|---|
| `npm test` | PASS, 16/16 (14 original + 2 new) |
| `tsc --noEmit` | PASS |
| `npm run build` | PASS |
| `test:accounts` | PASS, 25/25 |
| `test:integration` (incl. FIN-01 to FIN-20) | PASS, 24/24 |
| `test:browser` (13 widths, 320 to 1920) | PASS, 213 checks; external font stubbed offline |
| `test:e2e` | PASS, 29 checks |
| `backup:validate` | PASS (9 tables, counts and row digests match after restore) |
| `npm audit` (online) | 0 known vulnerabilities across the lockfile at time of run; not a substitute for a security review |
| Secret scan of tracked files | No real credentials found |

NOT TESTED: real Resend delivery, hosted HTTPS/proxy, managed-PostgreSQL TLS, least-privilege DB role on a real host, off-host backups, load testing, PDF/print output beyond what the existing suites cover.

## Files modified

`server/mail.cjs`, `server/accounts.cjs`, `server/index.cjs`, `server/deletion.cjs`, `src/main.ts`, `scripts/cleanup.cjs` (new), `scripts/package-release.py`, `package.json`, `.env.example`, `tests/security.test.cjs`, `docs/PRODUCTION_RUNBOOK.md`, this report.

## External prerequisites

Resend account, API key and verified sending domain; real send test to an authorized inbox; production hosting with HTTPS and proxy (set `TRUST_PROXY=true`); managed PostgreSQL certificate and least-privilege runtime role; encrypted off-host backups with a rehearsed restore; approved privacy/terms/retention/support details; independent security and load review; billing and entitlements if charging.

## Hosting decision

| Target | Verdict |
|---|---|
| Local development | YES |
| Private staging | CONDITIONAL: real email, host TLS/proxy and DB checks with disposable testers |
| Private beta | CONDITIONAL: approved policies and support, tested recovery, real email working |
| Public free launch | NO: external prerequisites above are open |
| Paid commercial launch | NO: no billing/entitlements; plus all of the above |

Unchanged from `docs/LAUNCH_GATES.md`; this audit found no reason to raise or lower any verdict.

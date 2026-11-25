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

- **P2 (partly resolved, see follow-up):** account emails are retried in-process for transient failures only; a restart during the retry window loses the retry, and there is no bounce/delivery webhook handling.
- **P3:** Login is limited per email as well as per IP, so someone can deliberately trigger lockouts for a known address (15-minute window). Standard trade-off; consider CAPTCHA or progressive delay.
- **P3:** Sessions are fixed 30-day with no idle timeout or rotation; cookie is not `__Host-` prefixed; HSTS has no `includeSubDomains`/preload. Acceptable for private beta.
- **P3 (resolved in the UI/UX pass below):** fonts are now self-hosted and the CSP no longer allows Google.
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

## UI/UX pass (25 November 2026, commit on `claude/audit-fixes`)

Scope: contrast, small text, reduced motion, self-hosted font, design tokens, responsive QA. Dark mode, RTL, backend, database and financial logic were not touched. Branding, sidebar, header and dashboard layout are unchanged.

| ID | Priority | Issue | Action | Verification |
|---|---|---|---|---|
| U-01 | P2 | 22 text/background pairs below AA, measured per element against the real composited background (gradients worst-case, opacity applied). | Muted greys, eyebrow, status chips and unread badge moved to tokens that pass 4.8:1 or better on every surface they appear on. | `tests/ui-audit.cjs contrast`: 1,172 text nodes, 0 failures (was 22). |
| U-02 | P2 | Focus ring `#79bdb1` was 2.2:1 on white (WCAG 1.4.11 needs 3:1). Four slightly different ring colours. | One `--cp-focus-ring` (#2b7e6f, 4.9:1); consistent 3px ring for links, inputs, selects, textareas. | 122 Tab stops at 1280 and 375 px: all have a visible indicator and none is obscured. |
| U-03 | P2 | 18 kinds of text at 9 to 11.5px, including bottom-nav labels, table headers and amounts. | Floor of 12px (`--cp-fs-xs`); sidebar tagline now wraps instead of clipping. | 0 text under 12px; no horizontal overflow on 7 views at 14 widths. |
| U-04 | P3 | No `prefers-reduced-motion` handling. | Global reduce rule (instant transitions, no smooth scroll). | With reduce emulated: 0 elements still animating. |
| U-05 | P2 | DM Sans loaded from Google (render-blocking `@import`, third-party request, CSP exceptions). | Self-hosted variable WOFF2 (latin 37 KB, latin-ext 18 KB, loaded only when needed), `font-display: swap`, preload of the latin file, OFL licence kept. Weight range capped at 700 so existing 750/800 rules look as before. CSP now `style-src 'self' 'unsafe-inline'; font-src 'self'`. Hashed `/assets/` files are cacheable (immutable); `.woff2` served as `font/woff2`. | Browser suite: font loaded, no third-party requests, CSP and MIME and cache headers asserted. |
| U-06 | P3 | Hardcoded values (147 distinct hex colours, ad hoc radii/sizes/spacing). | `src/tokens.css`: type, weight, spacing, radius, and the repeated or measured colours; CSS rewritten to use them. | Pixel diff vs baseline: all non-radius substitutions identical (34 of 37 images exact; 3 differ by at most 13 pixels at 1/255). |

Visual-fidelity notes: radii were snapped by at most 1px onto a 7-step scale (about 0.1% of pixels differ, corners only). Earlier sandbox screenshots used a fallback font because Google was unreachable, so before/after comparisons include the real DM Sans.

Results (this pass): `tsc` clean, build OK, unit 16/16, accounts 25/25, integration 24/24, browser 217 checks (213 + 4 new), e2e 29. UI audit: 98 width/view checks including 2560px; 200% and 400% zoom reflow (1280 and 1920 base, plus 200% root text size) with no horizontal scroll; forced-colors and reduced-motion emulation.

Limits: the contrast scan covers rendered text in the tested screens and states, not placeholders, hover/disabled states or pseudo-element text. Forced-colors was checked by a heuristic (controls keep a border, outline or fill), not by visual review. 400% zoom was emulated with a narrower viewport. No screen reader, real-device, Core Web Vitals or Windows high-contrast testing. About 110 one-off colour literals remain in the CSS (near-duplicate shades that would change appearance if merged). The font has no metric-matched fallback, so a brief layout shift is possible before it loads; the preload makes this unlikely but it was not measured.

## Follow-up pass: email retry and CI (25 November 2026)

| ID | Priority | Issue | Action | Verification |
|---|---|---|---|---|
| F-01 | P2 | Account email was single-attempt; a brief provider blip meant the user had to request a resend. | `sendWithRetry`: up to 3 attempts for timeout, network, 429 and 5xx only, backoff about 2 s and 15 s, one idempotency key reused. A database outbox was rejected on purpose: it would persist raw verify/reset links next to hashed tokens. | New unit test: 503 then 200 sends twice with the same key; 403 sends once; persistent 500 stops at 3 attempts; logs contain no key, address or link. |
| F-02 | P2 | No CI. | `.github/workflows/ci.yml`: tsc, build, unit, online `npm audit --audit-level=high`, accounts and integration on **PostgreSQL 18** with PG 18 client tools, migrate then restore validation, browser, e2e, UI audit; failure screenshots kept 7 days. | YAML parses; the same command sequence passed locally on PostgreSQL 16 (unit 17/17, accounts 25/25, integration 24/24, restore validation over 9 tables, browser 217, e2e 29, UI audit 0 contrast failures). **The workflow itself has not run on GitHub yet**, so PostgreSQL 18 compatibility is still unverified until the first run. |

Still open from the earlier list: real Resend delivery test, bounce/delivery webhooks, hosted HTTPS/proxy and managed-database TLS checks, off-host backups, session idle timeout and `__Host-` cookie, per-email login lockout trade-off, real-device and screen-reader testing, Core Web Vitals.

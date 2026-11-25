# Phase 2 production runbook — 24 November 2026

Read QA_REPORT.md and POLICY_OWNER_CHECKLIST.md. This is a buildable release preparation, not a hosted launch. Existing customer records were not reset. The hosted AppDeploy application was not changed.

## Windows setup and local checks

Use npm.cmd if PowerShell execution policy blocks npm.ps1. Do not weaken global execution policy.

```powershell  
npm.cmd ci
# For a fresh installation only; do not overwrite an existing configured .env:
if(!(Test-Path -LiteralPath .env)){Copy-Item .env.example .env}
# Edit .env privately with the existing database connection.
npm.cmd run doctor
npm.cmd test
.\node_modules\.bin\tsc.cmd --noEmit
npm.cmd run build
npm.cmd start
```

Open exactly http://localhost:3000 with the supplied canonical origin. 127.0.0.1:3000 is a different origin and intentionally rejected for writes. Vite development origins on port 5173 are approved only outside production. Do not add arbitrary origins or forward untrusted X-Forwarded-For into authentication decisions.

## Additive migration and compatibility

Back up first. Use a migration-role DATABASE_URL and run:

```powershell
npm.cmd run db:migrate
```

server/schema.sql is the canonical, idempotent schema/migration. Migration runs on a single pinned PostgreSQL connection in one transaction with an advisory lock. It adds account status, email verification, policy acknowledgment, workspace archival, action tokens, database-backed rate limits and deletion requests. It does not delete/reset financial records or sessions. Review existing column compatibility separately: IF NOT EXISTS does not repair incompatible pre-existing definitions.

Existing rows receive verification_required=false and email_verified_at=NULL: they retain legacy-compatible access without being falsely represented as email-verified. Future inserts default verification_required=true; signup sets it explicitly. Existing sessions continue working. Decide whether to require legacy owners to verify before real beta/public access; forcing that policy later is a separate reviewed migration, not a silent part of this release.

New and reset passwords use versioned scrypt N=32768, r=8, p=3 (32 MiB core memory cost), fresh 16-byte salts and 64-byte keys. Existing salt:hash values retain N=16384, r=8, p=1 compatibility and upgrade when a password is reset. Login performs both derivation workloads for current, legacy and unknown accounts to reduce account-existence timing differences. No passwords are needed for migration. Hashing is asynchronous; tune capacity on your actual host before public exposure.

Production startup defaults to MIGRATE_ON_START=false and checks for the Phase 2 schema. Local development defaults to additive migration at startup. Production migration credentials should not be available to the HTTP process. Back up and migrate before starting a new build; do not point a new build at an unmigrated customer database.

## Email configuration

Production requires server-side configuration:

```dotenv
NODE_ENV=production
PUBLIC_ORIGIN=https://YOUR_APPROVED_HOST
COOKIE_SECURE=true
MIGRATE_ON_START=false
EMAIL_PROVIDER=resend
EMAIL_FROM=YOUR_VERIFIED_SENDER
RESEND_API_KEY=SET_IN_SECRET_MANAGER
DEV_MAIL_SINK=false
```

Configure and verify the sender domain with Resend, including its required DNS records. Test real delivery, spam handling, sender identity and the canonical link host using disposable addresses before rollout. No actual provider delivery was tested here. The adapter uses the server-side Resend HTTPS API with a 10-second timeout and an idempotency key. SMTP is not included. The legacy RESEND_FROM_EMAIL setting remains a fallback; explicit EMAIL_PROVIDER and EMAIL_FROM are preferred.

For private local development ONLY, set EMAIL_PROVIDER=development and DEV_MAIL_SINK=true in your private .env, then restart. Messages (including secret links) appear as JSON files under ignored artifacts/mail-sink. There is no HTTP inbox endpoint and no token in API responses or logs. Restrict Windows folder ACLs to the developer account. Open a message privately to copy the link; never post its contents in chat or commit it. Delete local messages after testing. Development mode/sink are forbidden in production. With the sink disabled and no configured provider, accounts can sign in to private mode but cannot verify or use restricted features until delivery is enabled.

Signup returns the same generic response for new and duplicate email addresses and creates no session. Sign in separately. Verification links last 24 hours; reset links last 30 minutes. Only token hashes are stored in the database. Resending invalidates older links. Verification is confirmed by POST after the user clicks the page button. Reset consumes a token atomically, invalidates all other outstanding reset tokens and all prior sessions, and does not automatically log in.

Links put the secret in the fragment; the UI removes it from browser history after loading. Refreshing that screen loses the token, so reopen the original link or request another. Email delivery is initiated after token creation and is best effort in the running process, with safe failure logging. A crash before send can require a resend; no durable mail queue/retry worker is claimed. Monitor account-email failures and provider delivery events before launch. Email acknowledgment is not proof of delivery.

## Account access, export and deletion

New unverified users may sign in, create a private workspace and record their own expenses. Sending/accepting invitations, removing workspace access, account export and deletion requests require verified email or the documented legacy-access exception. Profile customization remains available independently of email verification. Only authorized workspace members can access shared data; archived workspaces are read-only.

Account export includes profile, account metadata, membership, authorized shared ledger, user-created expenses/reimbursements, notification read state, request status, schema version and export timestamp. It excludes password hashes, session/action/invitation tokens and the other parent's private account details. Exports and downloaded backups are sensitive files controlled by their recipient; they cannot be remotely erased.

Deletion is a request/review workflow, not an unsafe Delete Account shortcut. The user must enter their current password and REQUEST DELETION. Repeated requests preserve the same reference. Request submission does not disable the account. The operator must review shared text, retention grounds, identity, legal holds and backup expiration, then run the completion command with a restricted operational role:

```powershell
npm.cmd run account:complete-deletion -- --request-id REQUEST_UUID --retention-reviewed --backup-retention-days OWNER_APPROVED_DAYS --review-note "Shared records and legal holds reviewed; approved retention recorded"
```

Replace every placeholder after approval. Do not put sensitive case details, passwords or child information in review notes. The command refuses a legal hold, unknown request, invalid retention settings or missing review acknowledgment. Manage legal_hold on the request through the operator's trusted database process; there is no public admin endpoint or automatic hold override. Record the request reference and completion time in an encrypted, access-controlled deletion register for disaster recovery.

Completion disables login, revokes sessions/tokens/invitations, removes profile and notification read records, and anonymizes the account name/email plus invitations addressed to that email. Financial entries, attribution UUIDs, creation metadata and the deletion audit record remain. Shared text can still contain personal information and requires separately approved review. No paid expense or reimbursement is deleted.

If a current member closes, their membership is removed and the ledger is archived. If the owner closes, the owner ID remains a disabled tombstone, the member remains authorized to read/export and the ledger is archived. Archival prevents assigning old obligations to a replacement co-parent. No automatic ownership transfer or new-workspace migration is provided. The remaining parent can customize their profile and export/view financial history. Operator review is required for future workspace arrangements. Backups, existing browser caches and downloaded files are not immediately rewritten.

## Isolated regression and recovery testing

As an administrator, create a disposable test database/role; the recovery validation requires CREATEDB on the TEST role only. Never grant that to production runtime.

```sql
CREATE DATABASE coparent_qa OWNER coparent_user;
```

```powershell
$env:TEST_DATABASE_URL='postgresql://QA_ROLE:PRIVATE_PASSWORD@127.0.0.1:5432/coparent_qa'
$env:PG_BIN='C:/Program Files/PostgreSQL/18/bin'
npm.cmd run test:accounts
npm.cmd run test:integration
# Install browser tooling separately if it is not already available:
npm.cmd install --no-save --package-lock=false playwright
npx.cmd playwright install chromium
npm.cmd run build
npm.cmd run test:browser
npm.cmd run test:e2e
npm.cmd run backup:validate
npm.cmd run benchmark:auth
```

Tests require a QA/_test database distinct from the application database name. They create generated schemas and disposable accounts and remove only their own schemas. Recovery validation creates a uniquely named empty recovery_*_test database, restores into that database only, compares counts and sorted row digests for all cp_* tables, then removes only the database it successfully created. There is no --clean or production restore target option. Keep the test source idle during validation. The account suite uses port 3095; E2E uses 3097. Browser tooling is optional for runtime; PLAYWRIGHT_MODULE can point to an existing cached installation.

The responsive suite uses API fixtures; the full-stack suite uses actual Node/PostgreSQL and separate browser contexts. DM Sans is self-hosted (`src/fonts`, OFL licence included), so no third-party font request is made and none is stubbed; the browser suite fails if any non-local request occurs. `npm run test:ui` measures per-element contrast, 13+ widths incl. 2560, 200%/400% reflow, forced-colors, reduced motion and keyboard focus. This audit used a separate PostgreSQL instance on loopback 55439 under ignored artifacts/pgqa, not customer data on port 5432. A generated nonempty financial fixture was also checked after an actual PostgreSQL restart; always wait for pg_isready before probing after restart.

## Hosting, security and operations

Use a supported Node LTS compatible with engines (>=22.13), rerun suites on that exact runtime, and verify PostgreSQL provider compatibility. This execution used Node 25.9.0 and PostgreSQL 18.6; LTS hosting compatibility remains an external gate.

Use HTTPS at a trusted reverse proxy and restrict direct backend access. Set PUBLIC_ORIGIN to the exact HTTPS origin. Cookies remain Secure based on that configuration regardless of spoofed X-Forwarded-Proto. The server does not trust forwarding headers for client IP or canonical-origin decisions. Production emits HSTS; JSON/static responses have no-sniff/frame/referrer protections and static CSP. Dotfiles are rejected. Authentication endpoints use origin checks; do not remove them. Proxy users can share one IP; configure and verify perimeter throttling as well.

AUTH_RATE_LIMIT_MAX defaults to 18 per IP/action and login email in 15 minutes. TOKEN_RATE_LIMIT_MAX defaults to 20 per submission action/IP in 15 minutes. EMAIL_RATE_LIMIT_MAX defaults to 3 per address/action per hour. Counters live in PostgreSQL and are shared across processes. Keys are hashed; rate-limit correctness is not dependent on a per-node Map. Preserve abuse limits when tuning. Approve and schedule expiry cleanup for cp_rate_limits, expired cp_sessions and expired/used cp_action_tokens under the retention policy; no production cleanup job was installed.

Configure managed PostgreSQL certificate verification (e.g. sslmode=verify-full and trusted CA through PGSSLROOTCERT); never disable certificate validation. Apply per-process PGPOOL_MAX limits within the provider's total connection budget. Runtime role needs CONNECT, schema USAGE and SELECT/INSERT/UPDATE/DELETE on app tables, including the new token/rate/deletion tables. It needs no table ownership, DDL, CREATEDB, CREATEROLE or superuser rights. Keep migration/operator roles separate. Reapply default privileges for new tables after migration as necessary.

```sql
GRANT CONNECT ON DATABASE coparent_db TO coparent_runtime;
GRANT USAGE ON SCHEMA public TO coparent_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO coparent_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE coparent_migrator IN SCHEMA public
 GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO coparent_runtime;
```

The JSONB ledger remains protected by application validation and locked revision updates, not normalized per-expense SQL foreign keys. Do not give untrusted clients direct database credentials. Account closure is serialized with account-sensitive writes. Financial history remains immutable through the API.

The server emits an X-Request-ID and redacted JSON unexpected-error records; no raw request bodies, URLs, tokens, credentials or database error details are logged. Configure your host to collect stdout/stderr, restrict retention/access, and alert on request_failed, mail delivery failures, database connection failures, health checks and backup_failed. Configure process supervision and an incident owner. No external monitoring account or alert destination was invented or connected. /api/health checks SELECT 1 and returns generic errors on failure. HTTP request/header/keep-alive timeouts and request body limits are bounded. SIGTERM/SIGINT drains HTTP/pool with a 10-second deadline; verify the hosting platform's actual signals and allow a longer supervisor grace period.

## Backups, scheduling, restoration and rollback

`npm.cmd run backup` remains available. Set PG_BIN or put matching tools on PATH. It creates a unique custom-format dump under ignored backups/ and validates the PGDMP header. The password is passed to the child environment, not its command line. Logs contain status, basename, size and timestamp; provider/database errors are redacted. Restrict folder ACLs, encrypt backups at rest and in transit, copy off-host, rotate encryption keys under access control and monitor backup age/job exit status. The local dump/restore test does not validate cloud storage, PITR, RPO/RTO or off-host recovery credentials.

ops/backup-task.ps1 is a scheduler wrapper that appends safe logs and returns failure status. Example task registration (choose your approved time, identity and frequency; this task was NOT registered automatically):

```powershell
$projectRoot=(Get-Location).Path
$scriptPath=Join-Path $projectRoot 'ops/backup-task.ps1'
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -File "'+$scriptPath+'"')
$trigger=New-ScheduledTaskTrigger -Daily -At '02:00'
# Register under a dedicated account with private .env/pgpass ACLs; never put a password in the task arguments.
Register-ScheduledTask -TaskName 'CoParent PostgreSQL backup' -Action $action -Trigger $trigger
```

The example time is local Windows time, not an imposed backup policy. Select frequency and retention from the approved RPO, legal obligations and hosting capacity. No fixed production retention days were invented. Ensure the task account has Node/PostgreSQL tools and appropriate filesystem/database rights.

Restore into a NEW empty database with matching tools and private pgpass/connection environment first:

```powershell
createdb coparent_recovery_test
pg_restore --exit-on-error --dbname=coparent_recovery_test .\backups\APPROVED_BACKUP.dump
```

Run financial reconciliation, authentication/account-state checks and replay completed deletions from the external deletion register before exposing a recovered service. Backups must expire under the approved schedule; a restored copy must not silently reactivate deleted accounts. Never restore over live customer writes as an experiment.

Record artifact checksum, migration SQL review and backup reference before each deploy. Because Phase 2 is additive, rollback can restore a prior compatible server/dist artifact while retaining new columns/tables. HOWEVER a Phase 1 server does not enforce closed-account status/archival and cannot read new versioned password hashes. Never roll back to an unpatched Phase 1 backend after Phase 2 account operations/password changes. Use a compatible hotfix or a reviewed maintenance-window recovery plan; do not drop tables or undo financial writes.

## Release prerequisites

Complete POLICY_OWNER_CHECKLIST.md. Finalize business-specific policies/support and record approval. Configure and test real email delivery, HTTPS/proxy, managed DB TLS and least privilege, off-host recovery/retention, monitoring and deletion operations. Run a fresh online npm audit, independent security review and target-host abuse/load tests. Public/paid launch remains NO until these gates are met. The tool records external reimbursements; it does not process or settle money.

Reference checks: [Node scrypt API](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback), [OWASP password storage parameters](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Resend send-email API schema](https://github.com/resend/resend-openapi/blob/main/resend.yaml), [PostgreSQL row locks](https://www.postgresql.org/docs/18/explicit-locking.html).

## Audit additions (Claude audit, 25 November 2026)

**Email delivery.** `EMAIL_PROVIDER=development` never contacts any mail service; it only writes JSON files under `artifacts/mail-sink` on the machine running the server, so nothing reaches Gmail. Real delivery requires `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` from your secret manager and an `EMAIL_FROM` on a domain verified in Resend. Production now refuses to start with a placeholder `example.*` sender or a malformed `EMAIL_FROM`. A 2xx response from Resend means accepted for sending, not delivered: confirm delivery in the Resend dashboard. Failed sends are logged as `mail_delivery_failed` with only provider, HTTP status and Resend's short error name (for example `validation_error`, `invalid_api_key`); never keys, recipients or links. Reset and verification emails are sent after the response, are not queued and are not retried automatically; users recover with the rate-limited resend (default 3 per address per hour).

**Reverse proxy and rate limits.** Behind a proxy every request appears to come from the proxy address, so all users would share one limit. Set `TRUST_PROXY=true` only when a proxy you control appends `X-Forwarded-For` and Node is not directly reachable; the last entry is used, so client-supplied earlier entries cannot evade limits. Leave it unset otherwise.

**Maintenance.** Run `npm run maintenance:cleanup` daily (add `-- --dry-run` to count first). It deletes only expired sessions, expired rate-limit counters and action tokens expired more than 7 days ago. It does not touch users, workspaces, ledgers or invitations. Run it with the application role.

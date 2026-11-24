# Source origin and exact-match boundaries

User-provided archive: `coparent-expense-manager-udsliz-7b67d4f6-c9e1-4898-aea0-6210c3778f5a-build-manifest (1).zip`.

Included all original Vite frontend source from `source/`:
- `src/main.ts` (original visual markup, exact sidebar/header/dashboard layout retained; client import and documented bug fixes changed)
- `src/styles.css` (original visual system retained; targeted gutter/wrapping fixes and removal of global overflow clipping, local auth styles in separate file)
- `index.html` (duplicate direct CSS import removed; Vite handles CSS from main entry)
- `public/favicon.svg` (original bytes unchanged)
- `vite.config.ts` (development API proxy and local dist output)
- `backend/index.ts` (original AppDeploy backend retained, *not portable* because it imports `@appdeploy/sdk`)
- `tests/tests.json` (original AppDeploy QA test scenarios retained; local runnable tests are `tests/*.test.cjs`)

`src/app-client.ts` substitutes for `@appdeploy/client` and implements the same high-level methods required by this UI. A local PostgreSQL/Node backend substitutes for AppDeploy-managed database, authentication and invites.

**Visual equivalence:** the actual uploaded CSS, DOM structure, logo and desktop/mobile layout are used directly; changes to gross balance copy, pending items and accessibility are intentional. Full pixel equality with the live AppDeploy rendering requires browser screenshot comparison after local install and is not claimed.

**User data:** none extracted. Build manifest is metadata, not database or secrets. Original AppDeploy sign-in accounts cannot be imported as plaintext passwords.


## Phase 2 additions (24 November 2026)

New account/recovery/policy screens use the existing visual palette and panels in separate account-ui.ts, policies.ts and account.css. main.ts and app-client.ts retain the original financial layout and add route/account integration; core styles.css and the original logo are preserved. Server account/mail/security/deletion/database modules and additive schema fields implement local account lifecycle, not AppDeploy account migration. Historical hosted authentication/accounts and customer data remain excluded. Current test/launch evidence is in QA_REPORT.md; QA_REPORT_PHASE1.md is an archived earlier report.

# PostgreSQL setup (Windows / Roman Urdu)

## 1. Install
- Node.js >=22.13: https://nodejs.org/
- PostgreSQL 16 or 17: https://www.postgresql.org/download/windows/
- Optional: VS Code: https://code.visualstudio.com/

## 2. PostgreSQL database create
Open **SQL Shell (psql)**, sign in as `postgres`, and run:

```sql
CREATE ROLE coparent_user WITH LOGIN PASSWORD 'CHOOSE_A_STRONG_PASSWORD';
CREATE DATABASE coparent_db OWNER coparent_user;
```

Do not post or share your password. Use URL encoding for special password characters in DATABASE_URL (e.g. @ is %40).

## 3. Configure project
In VS Code terminal, inside extracted `CoParent_Expense_Manager_Original_UI_PostgreSQL` folder:

```powershell
Copy-Item .env.example .env
notepad .env
npm install
npm run doctor
npm test
npm run dev
```

Set in `.env`:

```dotenv
DATABASE_URL=postgresql://coparent_user:CHOOSE_A_STRONG_PASSWORD@127.0.0.1:5432/coparent_db
PORT=3000
PUBLIC_ORIGIN=http://localhost:3000
COOKIE_SECURE=false
```

`npm run dev` exposes **http://localhost:5173**; Vite proxies `/api/` to the Node server on port 3000. On the first API start, tables are created automatically by `server/schema.sql`.

## 4. Parent A / Parent B setup
1. Sign up using account A in Chrome. Click **Create My Workspace**.
2. Settings -> Co-parent sharing -> enter your second test email -> Create Invite -> Copy link.
3. Open the link in another incognito browser profile, sign up with *exactly the invited address*, then **Accept Invitation**.
4. Compare notifications, expense ownership, gross balances, reports and pending amounts on both accounts.
5. For unrelated workspace C, use another separate private-browser profile and email; never test with real family records.

## 5. Production-style local build

```powershell
npm run build
npm start
```
Open http://localhost:3000. Use Ctrl+C to stop.

## 6. Database backup
Install PostgreSQL tools so `pg_dump` is available on your system PATH, then:

```powershell
npm run backup
```
Backup files are saved to `/backups/` (not included in source ZIP). Test restoration to a **separate database**; do not overwrite production while experimenting.

## 7. Common errors
- `ECONNREFUSED 127.0.0.1:5432` -> PostgreSQL service stopped or wrong port.
- `password authentication failed` -> check role/password and URL encoding.
- `database does not exist` -> create `coparent_db` with psql.
- `permission denied for schema public` -> ensure `coparent_user` owns the database or has schema CREATE permissions.
- `port 3000 already in use` -> stop other local servers or change both PORT and Vite proxy.
- `login works but workspace fails` -> inspect Node terminal logs; do not reset your DB.

## 8. Hosting later
For a real launch: managed PostgreSQL, HTTPS reverse proxy, `COOKIE_SECURE=true`, correct `PUBLIC_ORIGIN`, secret manager, persistent backup/recovery drills, operational monitoring, email verification/reset and rate limiting. Do not put production DATABASE_URL into frontend Vite environment variables.

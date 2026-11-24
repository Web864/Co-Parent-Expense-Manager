-- Local PostgreSQL schema for the original AppDeploy user interface.
-- Each connected family shares ONE versioned ledger, updated transactionally.
CREATE TABLE IF NOT EXISTS cp_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cp_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES cp_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS cp_sessions_user_idx ON cp_sessions(user_id);
CREATE TABLE IF NOT EXISTS cp_workspaces (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL UNIQUE REFERENCES cp_users(id),
  member_id TEXT UNIQUE REFERENCES cp_users(id),
  revision BIGINT NOT NULL DEFAULT 0,
  state JSONB NOT NULL DEFAULT '{"expenses":[],"payments":[],"names":{"a":"Parent A","b":"Parent B"}}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (owner_id IS DISTINCT FROM member_id)
);
CREATE TABLE IF NOT EXISTS cp_profiles (
  user_id TEXT PRIMARY KEY REFERENCES cp_users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT 'teal'
);
CREATE TABLE IF NOT EXISTS cp_invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES cp_workspaces(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cp_notification_reads (
  user_id TEXT NOT NULL REFERENCES cp_users(id) ON DELETE CASCADE,
  expense_id TEXT NOT NULL,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,expense_id)
);

-- Additive, safe to re-run; no customer rows are modified.
CREATE INDEX IF NOT EXISTS cp_sessions_expiry_idx ON cp_sessions(expires_at);
CREATE INDEX IF NOT EXISTS cp_invitations_workspace_idx ON cp_invitations(workspace_id);
-- Phase 2 is additive. Existing users remain legacy-compatible; do not claim their email was verified.
ALTER TABLE cp_users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE cp_users ADD COLUMN IF NOT EXISTS verification_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE cp_users ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active' CHECK(account_status IN ('active','closed'));
ALTER TABLE cp_users ADD COLUMN IF NOT EXISTS policy_acknowledged_at TIMESTAMPTZ;
ALTER TABLE cp_users ADD COLUMN IF NOT EXISTS policy_version TEXT;
ALTER TABLE cp_workspaces ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS cp_action_tokens (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES cp_users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('verify','reset')),
 email TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 used_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cp_action_tokens_user_idx ON cp_action_tokens(user_id,kind);
CREATE INDEX IF NOT EXISTS cp_action_tokens_expiry_idx ON cp_action_tokens(expires_at);
CREATE TABLE IF NOT EXISTS cp_rate_limits (
 key TEXT PRIMARY KEY,
 attempts INTEGER NOT NULL CHECK(attempts>0),
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS cp_rate_limits_expiry_idx ON cp_rate_limits(expires_at);
CREATE TABLE IF NOT EXISTS cp_deletion_requests (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL UNIQUE REFERENCES cp_users(id),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed')),
 legal_hold BOOLEAN NOT NULL DEFAULT false,
 requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 completed_at TIMESTAMPTZ,
 backup_retention_days INTEGER CHECK(backup_retention_days>=0),
 review_note TEXT
);

-- Existing rows retain false; future inserts must opt into the legacy exception deliberately.
ALTER TABLE cp_users ALTER COLUMN verification_required SET DEFAULT true;

-- ============================================================
-- XO CAPTURE - PostgreSQL Schema
-- Database: xo_quickstart
-- Engine: PostgreSQL 15 on RDS (db.t3.micro)
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS TABLE
-- Authentication and user management
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ============================================================
-- CLIENTS TABLE
-- Domain partner information (replaces metadata.json in S3)
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_name VARCHAR(255) NOT NULL,
    website_url VARCHAR(500),
    contact_name VARCHAR(255),
    contact_title VARCHAR(255),
    contact_linkedin VARCHAR(500),
    industry VARCHAR(255),
    description TEXT,
    pain_point TEXT,
    survival_metric_1 TEXT,
    survival_metric_2 TEXT,
    ai_persona TEXT,
    strategic_objective TEXT,
    tone_mode VARCHAR(50),
    s3_folder VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_s3_folder ON clients(s3_folder);

-- ============================================================
-- UPLOADS TABLE
-- Tracks individual file uploads per client
-- ============================================================
CREATE TABLE IF NOT EXISTS uploads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    filename VARCHAR(500) NOT NULL,
    file_type VARCHAR(100),
    s3_key VARCHAR(1000) NOT NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uploads_client_id ON uploads(client_id);

-- ============================================================
-- ENRICHMENTS TABLE
-- Tracks enrichment job runs and results
-- ============================================================
CREATE TABLE IF NOT EXISTS enrichments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'processing',
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    results_s3_key VARCHAR(1000)
);

CREATE INDEX IF NOT EXISTS idx_enrichments_client_id ON enrichments(client_id);

-- ============================================================
-- SKILLS TABLE
-- Domain-specific skills injected into Claude prompts
-- ============================================================
CREATE TABLE IF NOT EXISTS skills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    content TEXT,
    s3_key VARCHAR(1000),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skills_client_id ON skills(client_id);

-- ============================================================
-- BUTTONS TABLE
-- User-configurable action buttons (replaces localStorage)
-- ============================================================
CREATE TABLE IF NOT EXISTS buttons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    icon VARCHAR(50) DEFAULT 'Zap',
    color VARCHAR(20) DEFAULT '#3b82f6',
    url VARCHAR(500),
    sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_buttons_user_id ON buttons(user_id);
ALTER TABLE buttons ADD COLUMN IF NOT EXISTS show_on TEXT DEFAULT '["welcome"]';

-- ============================================================
-- GOOGLE DRIVE INTEGRATION (migration)
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_drive_refresh_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_drive_connected_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'manual';
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_model VARCHAR(100) DEFAULT 'claude-sonnet-4-5-20250929';

-- ============================================================
-- ENRICHMENT STAGE TRACKING (migration)
-- Values: extracting, transcribing, researching, analyzing, complete, error
-- ============================================================
ALTER TABLE enrichments ADD COLUMN IF NOT EXISTS stage VARCHAR(50) DEFAULT 'extracting';

-- ============================================================
-- SOURCE LIBRARY (migration)
-- Adds file management columns for toggle, replace, delete
-- ============================================================
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS parent_upload_id UUID REFERENCES uploads(id) ON DELETE SET NULL;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS replaced_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status);
CREATE INDEX IF NOT EXISTS idx_uploads_parent ON uploads(parent_upload_id);

-- ============================================================
-- CLIENT BRANDING (migration)
-- Logo and icon S3 keys for client visual identity
-- ============================================================
ALTER TABLE clients ADD COLUMN IF NOT EXISTS logo_s3_key VARCHAR(500);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS icon_s3_key VARCHAR(500);

-- ============================================================
-- STREAMLINE WEBHOOK TOGGLE (migration)
-- Per-client toggle to auto-send enrichment results to Streamline
-- ============================================================
ALTER TABLE clients ADD COLUMN IF NOT EXISTS streamline_webhook_enabled BOOLEAN DEFAULT FALSE;

-- ============================================================
-- CONTACT EMAIL & PHONE (migration)
-- Direct contact details for client primary contact
-- ============================================================
ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_email VARCHAR(500);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(100);

-- ============================================================
-- MULTI-CONTACT SUPPORT (migration)
-- JSON array of contacts; first element = primary contact
-- Legacy contact_* columns synced from contacts[0] on every write
-- ============================================================
ALTER TABLE clients ADD COLUMN IF NOT EXISTS contacts_json TEXT;

-- ============================================================
-- MULTI-ADDRESS SUPPORT (migration)
-- JSON array of addresses; first element = primary address
-- Each: {label, address1, address2, city, state, postalCode, country}
-- ============================================================
ALTER TABLE clients ADD COLUMN IF NOT EXISTS addresses_json TEXT;

-- ============================================================
-- PER-CLIENT WEBHOOK URL (migration)
-- Overrides STREAMLINE_WEBHOOK_URL env var when set
-- ============================================================
ALTER TABLE clients ADD COLUMN IF NOT EXISTS streamline_webhook_url VARCHAR(1000);

-- ============================================================
-- SYSTEM SKILLS (migration)
-- Make client_id nullable so system skills (client_id IS NULL) are global
-- ============================================================
ALTER TABLE skills ALTER COLUMN client_id DROP NOT NULL;

-- ============================================================
-- SYSTEM BUTTONS (migration)
-- Add client_id for client-specific buttons; NULL = system button
-- Make user_id nullable (system buttons have no owner user)
-- ============================================================
ALTER TABLE buttons ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE buttons ALTER COLUMN user_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_buttons_client_id ON buttons(client_id);

-- ============================================================
-- HUBSPOT SYNC (migration)
-- Bi-directional sync tracking between XO Capture and HubSpot CRM
-- ============================================================
ALTER TABLE clients ADD COLUMN IF NOT EXISTS hubspot_company_id VARCHAR(50);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS hubspot_contact_id VARCHAR(50);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS hubspot_last_sync TIMESTAMP;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS hubspot_last_enrichment_id VARCHAR(50);

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS hubspot_company_id VARCHAR(50);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS hubspot_last_sync TIMESTAMP;

-- system_config entries used by hubspot-sync Lambda:
--   hubspot_access_token (encrypted)
--   hubspot_refresh_token (encrypted)
--   hubspot_token_expiry
--   hubspot_last_full_sync
--   hubspot_intellagentic_company_id (HubSpot ID for Intellagentic master Company)

-- ============================================================
-- HUBSPOT SYNC LOG (migration)
-- Tracks every sync action and conflicts for review
-- ============================================================
CREATE TABLE IF NOT EXISTS hubspot_sync_log (
    id SERIAL PRIMARY KEY,
    record_type VARCHAR(20) NOT NULL,
    record_id UUID,
    hubspot_id VARCHAR(50),
    sync_direction VARCHAR(10) NOT NULL,
    fields_updated TEXT,
    fields_skipped TEXT,
    details TEXT,
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hubspot_sync_log_direction ON hubspot_sync_log(sync_direction);
CREATE INDEX IF NOT EXISTS idx_hubspot_sync_log_record ON hubspot_sync_log(record_type, record_id);

-- Approval flow
ALTER TABLE clients ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS approved_by TEXT;

-- Company LinkedIn
ALTER TABLE clients ADD COLUMN IF NOT EXISTS company_linkedin TEXT;

-- Engagements
CREATE TABLE IF NOT EXISTS engagements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    focus_area TEXT,
    contacts_json TEXT,
    status VARCHAR(50) DEFAULT 'active',
    approved_at TIMESTAMP WITH TIME ZONE,
    approved_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    hubspot_deal_id VARCHAR(50)
);
CREATE INDEX IF NOT EXISTS idx_engagements_client_id ON engagements(client_id);
CREATE INDEX IF NOT EXISTS idx_engagements_status ON engagements(status);
ALTER TABLE enrichments ADD COLUMN IF NOT EXISTS engagement_id UUID;
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS hubspot_note_id TEXT;
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS hubspot_synced_at TIMESTAMP;

-- Multi-tenant auth
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_role TEXT CHECK (account_role IN ('super_admin', 'account_admin', 'account_user', 'client_contact', 'contributor'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' CHECK (status IN ('invited', 'active', 'deactivated'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS user_client_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES users(id),
    assigned_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_uca_user_id ON user_client_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_uca_client_id ON user_client_assignments(client_id);

-- ============================================================
-- DOCUMENT_ANALYSES — per-file Stage 1 cache (xo-enrich)
-- One row per (upload version, prompt version) pair. Re-enriching an
-- unchanged corpus reuses these rows; changing the file (new ETag) or
-- bumping STAGE1_PROMPT_VERSION naturally invalidates the cache.
-- ============================================================
CREATE TABLE IF NOT EXISTS document_analyses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    upload_id UUID NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    etag TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    stage1_output JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (upload_id, etag, prompt_version)
);

CREATE INDEX IF NOT EXISTS idx_document_analyses_upload_id
    ON document_analyses(upload_id);

-- Error reporting for failed enrichment runs (Stage 1 throttle/exhaust, etc.).
-- Status='failed' rows now also carry a human-readable explanation here.
ALTER TABLE enrichments ADD COLUMN IF NOT EXISTS error_message TEXT;

-- ============================================================
-- SALESFORCE + GONG INTEGRATIONS — Stage 0 infrastructure
-- Multi-tenant credential storage, OAuth CSRF protection, and per-client
-- connection overrides for the partner model (e.g. Zak's multi-org case).
--
-- HUBSPOT ASYMMETRY (intentional): HubSpot is the only integration that
-- writes NULL account_id rows in system_config — Intellagentic is the sole
-- HubSpot account. hubspot-sync/_get_config / _set_config continue to read
-- and write unscoped (NULL) rows. Do NOT backfill HubSpot rows to an
-- Intellagentic account_id — it will break the production HubSpot sync.
-- Salesforce and Gong route through shared/integrations_config.py and
-- require non-NULL account_id.
-- ============================================================
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS account_id
    INTEGER REFERENCES accounts(id) ON DELETE CASCADE;
-- Replace legacy global UNIQUE(config_key) with per-account scoping.
-- NULLS NOT DISTINCT keeps HubSpot's single NULL row unique while letting
-- per-account Salesforce/Gong rows coexist under the same config_key.
ALTER TABLE system_config DROP CONSTRAINT IF EXISTS system_config_config_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_config_account_key
    ON system_config (account_id, config_key) NULLS NOT DISTINCT;

-- OAuth state CSRF defense. Single-use, 10 min TTL (enterprise SSO + MFA
-- can exceed 5 min). Cleanup is opportunistic on each /connect.
CREATE TABLE IF NOT EXISTS oauth_state_nonces (
    nonce TEXT PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    integration TEXT NOT NULL CHECK (integration IN ('salesforce', 'gong')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_nonces_expires
    ON oauth_state_nonces(expires_at);

-- Per-client connection overrides (partner model). NULL columns mean
-- "inherit from account-level system_config" — the team model is the
-- degenerate case where no row exists or all columns are NULL.
-- connected_by uses ON DELETE SET NULL so the audit pointer never blocks
-- a user deletion and the integration row survives.
CREATE TABLE IF NOT EXISTS client_integrations (
    client_id UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,

    salesforce_instance_url TEXT,
    salesforce_access_token_encrypted TEXT,
    salesforce_refresh_token_encrypted TEXT,
    salesforce_token_expiry TIMESTAMP WITH TIME ZONE,
    salesforce_connected_by UUID REFERENCES users(id) ON DELETE SET NULL,
    salesforce_connected_at TIMESTAMP WITH TIME ZONE,

    gong_workspace_id TEXT,
    gong_access_key_encrypted TEXT,
    gong_access_key_secret_encrypted TEXT,
    gong_webhook_secret_encrypted TEXT,
    gong_connected_by UUID REFERENCES users(id) ON DELETE SET NULL,
    gong_connected_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- CROSS-TENANT CLIENT SHARING (PR 3.4) — owned by clients lambda
-- (_run_sharing_migration). Enables co-sell visibility between accounts.
--
-- client_shares grants an account-level share of a client. Composite PK
-- on (client_id, shared_with_account_id) prevents duplicate grants.
-- permissions enum: 'read_only' | 'read_write'. Reads accept either;
-- writes require 'read_write'.
--
-- ACCESS MODEL (Option 1, locked PR 3.4):
--   super_admin                  → all clients
--   account_admin (in B)         → own account + clients shared TO B
--   account_user/contributor (in B) → UCA-scoped; share grants visibility
--                                     at the account level, but per-user
--                                     access is still controlled by UCA
--                                     rows (cross-account assignments
--                                     now permitted when share exists).
--   client_contact               → unchanged (single client_id from JWT)
--
-- client_salesforce_links replaces clients.salesforce_account_id and
-- salesforce_last_sync with a per-tenant mapping — each account_id maps
-- the same shared client to its OWN SF Account Id. PR 3.4 dual-writes
-- both the legacy columns and the new table from salesforce-sync's
-- handle_sync_push. PR 3.5 cuts the SF read/write path over to this
-- table and drops the legacy columns.
-- ============================================================
CREATE TABLE IF NOT EXISTS client_shares (
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    shared_with_account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    granted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    permissions VARCHAR(20) NOT NULL DEFAULT 'read_write'
        CHECK (permissions IN ('read_only', 'read_write')),
    PRIMARY KEY (client_id, shared_with_account_id)
);
CREATE INDEX IF NOT EXISTS idx_client_shares_recipient
    ON client_shares(shared_with_account_id);

CREATE TABLE IF NOT EXISTS client_salesforce_links (
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    salesforce_account_id VARCHAR(18),
    salesforce_last_sync TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (client_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_client_sf_links_sf_account
    ON client_salesforce_links(salesforce_account_id);

-- Backfill — runs idempotently at clients lambda cold start.
-- See clients/lambda_function.py:_run_sharing_migration for the runtime.

-- ============================================================
-- SALESFORCE SYNC (PR 2 / Stage 1a) — per-record tracking + sync log
-- Owned by backend/lambdas/salesforce-sync/lambda_function.py
-- (_run_salesforce_migrations runs these idempotently at cold start).
-- ============================================================
ALTER TABLE clients ADD COLUMN IF NOT EXISTS salesforce_account_id VARCHAR(18);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS salesforce_last_sync TIMESTAMP WITH TIME ZONE;
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS salesforce_task_id VARCHAR(18);
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS salesforce_synced_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_clients_sf_account ON clients(salesforce_account_id);

-- PR 3.5: Opportunity reconciliation needs salesforce_opportunity_id on
-- engagements (separate from salesforce_task_id which the push activity uses).
-- Standard Opportunity field mirror columns added so the pull reconciler
-- can write back: stage, amount, close_date, description.
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS salesforce_opportunity_id VARCHAR(18);
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS stage VARCHAR(80);
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS amount NUMERIC(18,2);
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS close_date DATE;
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS description TEXT;
CREATE INDEX IF NOT EXISTS idx_engagements_sf_opportunity
    ON engagements(salesforce_opportunity_id);

-- PR 3.5: drop the single-valued legacy SF columns on clients. Per-tenant
-- mapping lives in client_salesforce_links (PR 3.4). After this drop:
--   - sf_push reads/writes client_salesforce_links scoped to JWT account_id
--   - sf_pull reconcile joins client_salesforce_links
--   - sf_contact_pull / sf_opportunity_pull build on the new pattern
-- The drop is idempotent (DROP COLUMN IF EXISTS) so re-running cold start
-- after the migration is safe.
DROP INDEX IF EXISTS idx_clients_sf_account;
ALTER TABLE clients DROP COLUMN IF EXISTS salesforce_account_id;
ALTER TABLE clients DROP COLUMN IF EXISTS salesforce_last_sync;

-- Sync log — one row per push/pull/conflict/spoof event. account_id-scoped
-- so each tenant only sees its own activity (enforced at the lambda layer).
-- PR 3 extends sync_direction to: 'push' | 'pull' | 'conflict' | 'spoof'.
-- The 'conflict' rows are read by the PR 4 conflict UI:
--   SELECT ... WHERE sync_direction = 'conflict' AND account_id = %s
-- The 'spoof' rows are written by the Outbound Message webhook when the
-- claimed OrganizationId doesn't match the stored salesforce_org_id —
-- useful for security audit / alerting.
CREATE TABLE IF NOT EXISTS salesforce_sync_log (
    id SERIAL PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    record_type VARCHAR(20) NOT NULL,    -- 'client' | 'engagement' | 'contact' | 'webhook'
    record_id UUID,
    salesforce_id VARCHAR(18),
    sync_direction VARCHAR(10) NOT NULL, -- 'push' | 'pull' | 'conflict' | 'spoof'
    fields_updated TEXT,                  -- JSON array of field names
    fields_skipped TEXT,                  -- JSON array of conflicting field names
    details TEXT,
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sf_sync_log_account ON salesforce_sync_log(account_id);
CREATE INDEX IF NOT EXISTS idx_sf_sync_log_record ON salesforce_sync_log(record_type, record_id);

-- ============================================================
-- GitHub #50 — uploads.status predicate alignment.
-- Backfill any pre-existing NULLs (production probe confirmed zero rows
-- as of 2026-04-26, but the UPDATE is idempotent and locks intent in
-- source for any environment that DOES have NULLs). Then enforce the
-- column shape so the source_count predicate (status='active') and the
-- enrich predicate (status='active' OR NULL) can collapse to a single
-- canonical form.
-- ============================================================
UPDATE uploads SET status = 'active' WHERE status IS NULL;
ALTER TABLE uploads ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE uploads ALTER COLUMN status SET NOT NULL;

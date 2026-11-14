CREATE TABLE IF NOT EXISTS app_revision (id integer PRIMARY KEY CHECK(id=1), revision bigint NOT NULL DEFAULT 0);
INSERT INTO app_revision(id,revision) VALUES(1,0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS drawings (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS works (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS assets (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS property_definitions (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS notes (id text PRIMARY KEY, data jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS assets_properties_gin ON assets USING gin ((data->'properties'));
CREATE UNIQUE INDEX IF NOT EXISTS assets_code_unique ON assets((data->>'code'));
CREATE TABLE IF NOT EXISTS attachments (id text PRIMARY KEY, name text NOT NULL, mime text NOT NULL, size bigint NOT NULL, content bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS api_tokens (id text PRIMARY KEY, token_hash text UNIQUE NOT NULL, name text NOT NULL, scope text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_events (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), action text NOT NULL, detail jsonb NOT NULL);

ALTER TABLE attachments ADD COLUMN IF NOT EXISTS thumbnail bytea;

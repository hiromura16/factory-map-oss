CREATE TABLE IF NOT EXISTS map_notion_connections (
 organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
 actor_id TEXT NOT NULL,
 token_cipher TEXT,
 parent_page_id TEXT NOT NULL DEFAULT '',
 home_page_id TEXT NOT NULL DEFAULT '',
 sources_json TEXT NOT NULL DEFAULT '{}',
 interval_minutes INTEGER NOT NULL DEFAULT 15,
 direction TEXT NOT NULL DEFAULT 'both',
 enabled INTEGER NOT NULL DEFAULT 0,
 requested INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'disconnected',
 job_json TEXT NOT NULL DEFAULT '{}',
 next_run_at TEXT,
 last_run_at TEXT,
 last_success_at TEXT,
 last_error TEXT,
 lease_token TEXT,
 lease_until TEXT,
 generation INTEGER NOT NULL DEFAULT 1,
 counters_json TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS notion_home_owner ON map_notion_connections(home_page_id) WHERE home_page_id!='';
CREATE INDEX IF NOT EXISTS notion_due ON map_notion_connections(next_run_at,lease_until);
CREATE TABLE IF NOT EXISTS map_notion_links (
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 kind TEXT NOT NULL,
 local_id TEXT NOT NULL,
 page_id TEXT NOT NULL,
 base_json TEXT,
 system_json TEXT,
 remote_edited_at TEXT,
 state TEXT NOT NULL DEFAULT 'pending',
 issue_json TEXT,
 resolution TEXT,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,kind,local_id),
 UNIQUE(organization_id,page_id)
);
CREATE INDEX IF NOT EXISTS notion_issues ON map_notion_links(organization_id,state);
CREATE TABLE IF NOT EXISTS map_notion_runs (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 started_at TEXT NOT NULL,
 finished_at TEXT,
 status TEXT NOT NULL,
 counters_json TEXT NOT NULL DEFAULT '{}',
 error TEXT
);
CREATE INDEX IF NOT EXISTS notion_runs_org ON map_notion_runs(organization_id,started_at DESC);

-- Append-only task changes and handover comments, isolated by organization.
CREATE TABLE IF NOT EXISTS map_task_events (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 task_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('created','updated','deleted','comment')),
 actor_id TEXT NOT NULL,
 reason TEXT NOT NULL,
 revision INTEGER NOT NULL,
 before_json TEXT,
 after_json TEXT,
 comment TEXT,
 file_ids TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS task_events_by_task ON map_task_events(organization_id,task_id,revision DESC,created_at DESC);
CREATE INDEX IF NOT EXISTS task_events_by_time ON map_task_events(organization_id,created_at DESC);

-- Work events are append-only through the application and survive deletion/import/restore.
CREATE TABLE IF NOT EXISTS map_work_events (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 work_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('baseline','created','updated','deleted')),
 actor_id TEXT NOT NULL,
 reason TEXT NOT NULL,
 revision INTEGER NOT NULL,
 before_json TEXT,
 after_json TEXT,
 file_ids TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS work_events_by_work ON map_work_events(organization_id,work_id,revision DESC);
CREATE INDEX IF NOT EXISTS work_events_by_time ON map_work_events(organization_id,created_at DESC);
INSERT OR IGNORE INTO map_work_events(id,organization_id,work_id,action,actor_id,reason,revision,after_json,file_ids,created_at)
SELECT 'baseline:'||o.id||':'||json_extract(w.value,'$.id'),o.id,json_extract(w.value,'$.id'),'baseline','migration','履歴機能の導入時点',o.revision,w.value,
 COALESCE((SELECT json_group_array(CASE WHEN a.type='text' THEN a.value ELSE COALESCE(json_extract(a.value,'$.fileId'),json_extract(a.value,'$.id')) END) FROM json_each(w.value,'$.attachments') a),'[]'),
 strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM organizations o,json_each(o.state_json,'$.works') w;

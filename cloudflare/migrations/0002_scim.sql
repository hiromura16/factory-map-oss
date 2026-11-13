CREATE TABLE scim_users (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 external_id TEXT NOT NULL,
 user_name TEXT NOT NULL,
 username_key TEXT NOT NULL,
 display_name TEXT NOT NULL DEFAULT '',
 active INTEGER NOT NULL CHECK(active IN (0,1)),
 deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(organization_id, external_id),
 UNIQUE(organization_id, username_key),
 UNIQUE(organization_id, user_id)
);
CREATE TABLE scim_events (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 resource_id TEXT NOT NULL REFERENCES scim_users(id),
 action TEXT NOT NULL,
 actor TEXT NOT NULL DEFAULT 'scim-service',
 created_at TEXT NOT NULL
);
CREATE INDEX scim_users_org ON scim_users(organization_id);
CREATE TABLE scim_guard (value INTEGER NOT NULL);

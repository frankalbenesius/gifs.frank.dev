BEGIN IMMEDIATE;

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE email_codes (
    email TEXT PRIMARY KEY COLLATE NOCASE,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    requested_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE auth_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_hash TEXT NOT NULL,
    requested_at INTEGER NOT NULL
);
CREATE INDEX auth_requests_lookup ON auth_requests(ip_hash, requested_at);

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE memberships (
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('member', 'manager')),
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (group_id, user_id)
);
CREATE INDEX memberships_user ON memberships(user_id);

CREATE TABLE invites (
    group_id TEXT PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL
);

CREATE TABLE gifs (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    upload_key TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(owner_id, upload_key)
);
CREATE INDEX gifs_owner ON gifs(owner_id, created_at DESC);

CREATE TABLE gif_tags (
    gif_id TEXT NOT NULL REFERENCES gifs(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (gif_id, tag)
);
CREATE INDEX gif_tags_tag ON gif_tags(tag, gif_id);

CREATE TABLE gif_groups (
    gif_id TEXT NOT NULL REFERENCES gifs(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    PRIMARY KEY (gif_id, group_id)
);
CREATE INDEX gif_groups_group ON gif_groups(group_id, gif_id);

PRAGMA user_version = 1;
COMMIT;

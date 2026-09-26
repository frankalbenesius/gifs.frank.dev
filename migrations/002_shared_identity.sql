BEGIN IMMEDIATE;

ALTER TABLE users ADD COLUMN identity_issuer TEXT;
ALTER TABLE users ADD COLUMN identity_subject TEXT;
CREATE UNIQUE INDEX users_identity ON users(identity_issuer, identity_subject)
    WHERE identity_issuer IS NOT NULL AND identity_subject IS NOT NULL;

PRAGMA user_version = 2;
COMMIT;

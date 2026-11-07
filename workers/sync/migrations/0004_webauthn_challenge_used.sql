-- Single-use WebAuthn challenges.
--
-- The dashboard Worker carries each passkey ceremony's challenge in a signed,
-- five-minute cookie. That proves the challenge came from the Worker, but on
-- its own it does not stop the same signed response being accepted twice
-- within those five minutes: the authenticator's signature counter can't be
-- relied on for that, because synced passkeys always report 0.
--
-- A ceremony that verifies now records its challenge here, and a challenge
-- that is already present is refused. Rows are written only after a
-- successful verification, so unauthenticated requests never write to this
-- table. Each row is pruned once its cookie could no longer be valid.
--
-- Read and written by workers/dashboard only. Not part of backups.

CREATE TABLE IF NOT EXISTS webauthn_challenge_used (
  challenge   TEXT    PRIMARY KEY,
  purpose     TEXT    NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenge_used_expires
  ON webauthn_challenge_used (expires_at);

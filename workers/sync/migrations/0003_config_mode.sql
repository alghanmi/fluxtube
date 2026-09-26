-- Durable "this instance is D1-managed" flag.
--
-- The sync Worker used to decide between D1-managed and env-managed config
-- by checking whether admin_passkey had any row. A recovery wipe empties
-- that table, which silently flipped sync back to the legacy env bindings
-- until someone re-claimed. From now on the dashboard writes
-- config.config_mode = 'd1' at first claim, and the sync Worker treats that
-- row (OR a passkey row, for instances migrated before this change) as
-- D1-managed.
--
-- Backfill: every instance that is claimed today gets the flag.

INSERT OR IGNORE INTO config (key, value, updated_at)
SELECT 'config_mode', 'd1', CAST(strftime('%s', 'now') AS INTEGER)
WHERE EXISTS (SELECT 1 FROM admin_passkey);

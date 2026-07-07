// R2 backup routes.
//
//   POST /api/backup/now                    → manual backup
//   GET  /api/backups                       → list objects
//   GET  /api/backup/:filename              → download raw JSON
//   POST /api/backup/restore/:filename      → restore from an object

import type { Hono } from 'hono';
import { requireAuth } from '../auth/require_auth';
import type { DashboardAuthEnv } from '../auth/require_auth';
import { ConfigRepo } from '../repos/config';
import {
  fetchBackupBody,
  generateBackup,
  listBackups,
  objectKey,
  restoreBackup,
} from '../backup';
import type { BackupEnv } from '../backup';

export interface BackupRoutesEnv extends DashboardAuthEnv, BackupEnv {}

export function attachBackupRoutes(app: Hono<{ Bindings: BackupRoutesEnv }>): void {
  app.post('/api/backup/now', async (c) => {
    const session = await requireAuth(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);

    try {
      const result = await generateBackup(c.env, new Date());
      await new ConfigRepo(c.env.DB).setPlain(
        'backup_last_success_at',
        String(Math.floor(Date.now() / 1000)),
        Math.floor(Date.now() / 1000),
      );
      return c.json({ ok: true, ...result });
    } catch (err) {
      await new ConfigRepo(c.env.DB).setPlain(
        'backup_last_failure_at',
        String(Math.floor(Date.now() / 1000)),
        Math.floor(Date.now() / 1000),
      );
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('_not_configured') ? 500 : 502;
      return c.json({ error: 'backup_failed', message }, status);
    }
  });

  app.get('/api/backups', async (c) => {
    const session = await requireAuth(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);
    if (!c.env.BACKUPS) return c.json({ error: 'backups_binding_not_configured' }, 500);

    const limitStr = c.req.query('limit');
    const limit = limitStr ? Math.max(1, Math.min(500, Number(limitStr))) : 100;
    try {
      const items = await listBackups(c.env, limit);
      return c.json({ backups: items });
    } catch (err) {
      return c.json({
        error: 'list_failed',
        message: err instanceof Error ? err.message : String(err),
      }, 502);
    }
  });

  app.get('/api/backup/:filename', async (c) => {
    const session = await requireAuth(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);
    if (!c.env.BACKUPS) return c.json({ error: 'backups_binding_not_configured' }, 500);

    const filename = c.req.param('filename');
    if (!isValidBackupKey(filename)) return c.json({ error: 'invalid_filename' }, 400);

    const body = await fetchBackupBody(c.env, filename);
    if (body === null) return c.json({ error: 'backup_not_found' }, 404);

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  });

  app.post('/api/backup/restore/:filename', async (c) => {
    const session = await requireAuth(c.req.raw, c.env);
    if (!session) return c.json({ error: 'unauthorized' }, 401);
    if (!c.env.BACKUPS) return c.json({ error: 'backups_binding_not_configured' }, 500);

    const filename = c.req.param('filename');
    if (!isValidBackupKey(filename)) return c.json({ error: 'invalid_filename' }, 400);

    try {
      const result = await restoreBackup(c.env, filename, Math.floor(Date.now() / 1000));
      return c.json({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'backup_not_found') return c.json({ error: message }, 404);
      if (message === 'backup_body_not_json' || message.startsWith('backup_schema_invalid')) {
        return c.json({ error: 'backup_corrupt', message }, 400);
      }
      return c.json({ error: 'restore_failed', message }, 500);
    }
  });
}

// Reject arbitrary keys — only backup objects following our naming
// convention. Same regex used to accept a UTC timestamp:
// `fluxtube-state_YYYY-MM-DD_HH-MM-SS.json`.
function isValidBackupKey(name: string): boolean {
  return /^fluxtube-state_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/.test(name);
}

/** Re-exported so tests can assert on the shape without duplicating regex. */
export { objectKey };

// Backup restore wizard — the one flow in the product that legitimately
// uses numbered markers per the Phase 10 design (this really is a
// sequence). Five steps:
//
//   1. Choose a backup     — list of R2 objects, newest highlighted.
//   2. Preview             — decoded payload rendered read-only.
//   3. Restore confirmation — danger card + hold-to-restore button.
//   4. Re-auth              — checklist of credentials the backup does
//                             not carry (Miniflux tokens, YouTube OAuth).
//   5. Done                 — success-green marker + summary + return.
//
// The wizard is invoked from BackupPanel by clicking "Preview & restore"
// on a specific row. That pre-selects the filename and starts at step 2;
// the operator can go back to step 1 to pick a different backup.

import { useEffect, useRef, useState } from 'preact/hooks';
import * as api from '../lib/api';
import { TubeIcon } from './icon/TubeIcon';

// Payload shape written by workers/dashboard/src/backup.ts. Kept narrow
// intentionally — only the fields we render need to be typed.
interface Payload {
  schema_version: number;
  exported_at: string;
  instance_id: string;
  miniflux_instances: Array<{ display_name: string; url: string }>;
  mappings: Array<{
    miniflux_url: string;
    miniflux_category: string;
    youtube_playlist_id: string;
    skip_shorts: boolean;
  }>;
  mapping_history?: Array<{ snapshot_json: string; actor: string; created_at: number }>;
  config?: Record<string, unknown>;
}

interface RestoreResult {
  restoredInstances: number;
  restoredMappings: number;
  restoredHistory: number;
  skippedMappings: number;
}

type Step =
  | { kind: 1 } // Choose a backup
  | { kind: 2; filename: string; payload: Payload }
  | { kind: 3; filename: string; payload: Payload }
  | { kind: 4; result: RestoreResult }
  | { kind: 5; result: RestoreResult };

export function RestoreWizard(props: {
  backups: api.BackupObject[];
  initialFilename: string;
  onExit: () => void;
}): preact.JSX.Element {
  const { backups, initialFilename, onExit } = props;
  const [step, setStep] = useState<Step>({ kind: 1 });
  const [selected, setSelected] = useState<string>(initialFilename);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // If the caller pre-selected a filename, auto-advance to step 2 once
  // on mount so the wizard opens on Preview.
  useEffect(() => {
    if (initialFilename) void openPreview(initialFilename);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openPreview(filename: string): Promise<void> {
    setPreviewing(true);
    setPreviewError(null);
    try {
      const res = await fetch(api.backupDownloadUrl(filename), {
        credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as Payload;
      setStep({ kind: 2, filename, payload });
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewing(false);
    }
  }

  async function executeRestore(filename: string): Promise<void> {
    setRestoreError(null);
    try {
      const result = await api.restoreFromBackup(filename);
      setStep({ kind: 4, result });
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : String(err));
    }
  }

  const currentStep = step.kind;

  return (
    <div class="wz">
      <StepRail current={currentStep} />

      {currentStep === 1 && (
        <StepChoose
          backups={backups}
          selected={selected}
          onSelect={setSelected}
          onPreview={() => void openPreview(selected)}
          onCancel={onExit}
          previewing={previewing}
          previewError={previewError}
        />
      )}
      {currentStep === 2 && step.kind === 2 && (
        <StepPreview
          filename={step.filename}
          payload={step.payload}
          onBack={() => setStep({ kind: 1 })}
          onContinue={() => setStep({ kind: 3, filename: step.filename, payload: step.payload })}
        />
      )}
      {currentStep === 3 && step.kind === 3 && (
        <StepConfirm
          filename={step.filename}
          payload={step.payload}
          error={restoreError}
          onBack={() => setStep({ kind: 2, filename: step.filename, payload: step.payload })}
          onCommit={() => void executeRestore(step.filename)}
        />
      )}
      {currentStep === 4 && step.kind === 4 && (
        <StepReauth result={step.result} onContinue={() => setStep({ kind: 5, result: step.result })} />
      )}
      {currentStep === 5 && step.kind === 5 && <StepDone result={step.result} onExit={onExit} />}
    </div>
  );
}

// ─── Step rail ────────────────────────────────────────────────────────

function StepRail(props: { current: 1 | 2 | 3 | 4 | 5 }): preact.JSX.Element {
  const { current } = props;
  const labels: Record<1 | 2 | 3 | 4 | 5, string> = {
    1: 'Choose',
    2: 'Preview',
    3: 'Confirm',
    4: 'Re-auth',
    5: 'Done',
  };
  return (
    <ol class="wz-rail">
      {[1, 2, 3, 4, 5].map((n) => {
        const state: 'past' | 'now' | 'future' | 'done' =
          n === 5 && current === 5
            ? 'done'
            : n < current
              ? 'past'
              : n === current
                ? 'now'
                : 'future';
        return (
          <li class={`wz-rail-item wz-rail-item--${state}`}>
            <span class="wz-rail-marker">{n}</span>
            <span class="wz-rail-label">{labels[n as 1 | 2 | 3 | 4 | 5]}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ─── Step 1: Choose a backup ─────────────────────────────────────────

function StepChoose(props: {
  backups: api.BackupObject[];
  selected: string;
  previewing: boolean;
  previewError: string | null;
  onSelect: (filename: string) => void;
  onPreview: () => void;
  onCancel: () => void;
}): preact.JSX.Element {
  const { backups, selected, previewing, previewError, onSelect, onPreview, onCancel } = props;
  return (
    <div class="wz-step">
      <h2 class="wz-step-title">Choose a backup.</h2>
      <p class="wz-step-lede">
        Pick the R2 object you want to preview. The newest backup is highlighted; every restore is
        irreversible, so restore only from a backup you actively want to bring back.
      </p>
      <table class="wz-table" role="grid" aria-label="Available backups">
        <thead>
          <tr>
            <th></th>
            <th>Filename</th>
            <th>Uploaded</th>
            <th>Size</th>
          </tr>
        </thead>
        <tbody>
          {backups.map((b, i) => {
            const isSelected = b.key === selected;
            const isNewest = i === 0;
            return (
              <tr
                class={`wz-row${isSelected ? ' wz-row--selected' : ''}${isNewest ? ' wz-row--newest' : ''}`}
                onClick={() => onSelect(b.key)}
              >
                <td>
                  <input
                    type="radio"
                    name="backup"
                    checked={isSelected}
                    onChange={() => onSelect(b.key)}
                    aria-label={`Select ${b.key}`}
                  />
                </td>
                <td class="wz-row-key">{b.key}</td>
                <td>{b.uploadedAt}</td>
                <td>{formatSize(b.sizeBytes)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {previewError && (
        <p class="wz-error" role="alert">
          <TubeIcon name="filament-error" size={16} /> {previewError}
        </p>
      )}
      <div class="wz-actions">
        <button class="wz-btn" onClick={onCancel}>
          Cancel
        </button>
        <button class="wz-btn wz-btn--primary" onClick={onPreview} disabled={!selected || previewing}>
          {previewing ? 'Loading preview…' : 'Preview this backup →'}
        </button>
      </div>
    </div>
  );
}

// ─── Step 2: Preview payload ─────────────────────────────────────────

function StepPreview(props: {
  filename: string;
  payload: Payload;
  onBack: () => void;
  onContinue: () => void;
}): preact.JSX.Element {
  const { filename, payload, onBack, onContinue } = props;
  return (
    <div class="wz-step">
      <h2 class="wz-step-title">Preview the backup.</h2>
      <p class="wz-step-lede">
        Read-only view of what's inside <code>{filename}</code>. This is what will replace your
        current mappings and Miniflux instances if you continue.
      </p>

      <div class="wz-preview-meta">
        <div>
          <label>Exported</label>
          <span>{payload.exported_at}</span>
        </div>
        <div>
          <label>Instance</label>
          <span>{payload.instance_id}</span>
        </div>
        <div>
          <label>Schema</label>
          <span>v{payload.schema_version}</span>
        </div>
      </div>

      <section class="wz-preview-block">
        <h3>Miniflux instances ({payload.miniflux_instances.length})</h3>
        <ul>
          {payload.miniflux_instances.map((inst) => (
            <li>
              <span class="wz-mono">{inst.url}</span>
              <span class="wz-muted">{inst.display_name}</span>
            </li>
          ))}
        </ul>
      </section>

      <section class="wz-preview-block">
        <h3>Mappings ({payload.mappings.length})</h3>
        <ul class="wz-mappings">
          {payload.mappings.map((m) => (
            <li>
              <span class="wz-mono">{m.miniflux_category}</span>
              <span class="wz-arrow" aria-hidden="true">
                →
              </span>
              <span class="wz-mono">{m.youtube_playlist_id}</span>
              {m.skip_shorts && <span class="wz-tag">skip shorts</span>}
            </li>
          ))}
        </ul>
      </section>

      <p class="wz-note">
        <TubeIcon name="encrypted" size={16} variant="muted" /> API tokens for Miniflux and the
        YouTube OAuth refresh token are <strong>excluded</strong> from backups by design. You'll
        supply them again in step 4.
      </p>

      <div class="wz-actions">
        <button class="wz-btn" onClick={onBack}>
          ← Choose a different backup
        </button>
        <button class="wz-btn wz-btn--primary" onClick={onContinue}>
          This is correct — continue →
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: Confirm + hold-to-restore ───────────────────────────────

function StepConfirm(props: {
  filename: string;
  payload: Payload;
  error: string | null;
  onBack: () => void;
  onCommit: () => void;
}): preact.JSX.Element {
  const { filename, payload, error, onBack, onCommit } = props;
  const [holdPct, setHoldPct] = useState(0);
  const [committing, setCommitting] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const commitedRef = useRef(false);
  const HOLD_MS = 1200;

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  function begin(): void {
    if (committing) return;
    commitedRef.current = false;
    startRef.current = performance.now();
    const tick = (now: number): void => {
      if (startRef.current === null) return;
      const elapsed = now - startRef.current;
      const pct = Math.min(1, elapsed / HOLD_MS);
      setHoldPct(pct);
      if (pct >= 1) {
        if (!commitedRef.current) {
          commitedRef.current = true;
          setCommitting(true);
          onCommit();
        }
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function cancel(): void {
    startRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (!commitedRef.current) setHoldPct(0);
  }

  return (
    <div class="wz-step">
      <h2 class="wz-step-title">Confirm the restore.</h2>
      <p class="wz-step-lede">
        This action cannot be undone. The current database rows below will be wiped and replaced
        with the contents of <code>{filename}</code>.
      </p>

      <div class="wz-danger-card">
        <h3>
          <TubeIcon name="filament-error" size={18} />
          Wipes on commit
        </h3>
        <ul>
          <li>{payload.miniflux_instances.length} existing Miniflux instance row(s) removed.</li>
          <li>All existing mappings removed and rewritten from the backup.</li>
          <li>Mapping history truncated to what the backup carries.</li>
          <li>
            API tokens and the YouTube refresh token are <em>not</em> in the backup — you'll re-
            supply them in step 4.
          </li>
        </ul>
      </div>

      {error && (
        <p class="wz-error" role="alert">
          <TubeIcon name="filament-error" size={16} /> {error}
        </p>
      )}

      <div class="wz-actions">
        <button class="wz-btn" onClick={onBack} disabled={committing}>
          ← Back
        </button>
        <button
          class="wz-btn wz-btn--danger wz-hold"
          style={`--hold-pct: ${holdPct * 100}%`}
          onMouseDown={begin}
          onMouseUp={cancel}
          onMouseLeave={cancel}
          onTouchStart={begin}
          onTouchEnd={cancel}
          onKeyDown={(e) => {
            if ((e as KeyboardEvent).key === ' ' || (e as KeyboardEvent).key === 'Enter') begin();
          }}
          onKeyUp={cancel}
          disabled={committing}
        >
          <span class="wz-hold-fill" aria-hidden="true" />
          <span class="wz-hold-label">
            {committing
              ? 'Restoring…'
              : holdPct > 0 && holdPct < 1
                ? `Hold to restore… ${Math.round(holdPct * 100)}%`
                : 'Hold to restore'}
          </span>
        </button>
      </div>
    </div>
  );
}

// ─── Step 4: Re-auth checklist ───────────────────────────────────────

function StepReauth(props: { result: RestoreResult; onContinue: () => void }): preact.JSX.Element {
  const { result, onContinue } = props;
  return (
    <div class="wz-step">
      <h2 class="wz-step-title">Restore complete — reconnect credentials.</h2>
      <p class="wz-step-lede">
        The backup didn't carry secrets. Restore any credentials before the next cron tick so the
        sync worker can talk to Miniflux and YouTube again.
      </p>
      <div class="wz-summary">
        <span>
          <strong>{result.restoredInstances}</strong> Miniflux instance{result.restoredInstances === 1 ? '' : 's'}
        </span>
        <span>
          <strong>{result.restoredMappings}</strong> mapping{result.restoredMappings === 1 ? '' : 's'}
        </span>
        <span>
          <strong>{result.restoredHistory}</strong> history row{result.restoredHistory === 1 ? '' : 's'}
        </span>
        {result.skippedMappings > 0 && (
          <span class="wz-warn">
            <strong>{result.skippedMappings}</strong> mapping{result.skippedMappings === 1 ? '' : 's'} skipped
          </span>
        )}
      </div>

      <ul class="wz-reauth">
        <li class="wz-reauth-item">
          <TubeIcon name="filament-error" size={20} />
          <div class="wz-reauth-body">
            <h3>Miniflux API tokens</h3>
            <p>Open Settings and paste the API token for each restored Miniflux instance.</p>
            <a href="/dashboard/settings" class="wz-reauth-cta">
              Go to Settings →
            </a>
          </div>
        </li>
        <li class="wz-reauth-item">
          <TubeIcon name="filament-error" size={20} />
          <div class="wz-reauth-body">
            <h3>YouTube OAuth</h3>
            <p>Reconnect YouTube so the sync worker can insert playlist items.</p>
            <a href={api.youtubeOAuthBeginUrl()} class="wz-reauth-cta">
              Reconnect YouTube →
            </a>
          </div>
        </li>
      </ul>

      <p class="wz-note">
        Once both are green on the mappings page, sync will resume on the next `*/30` tick.
      </p>

      <div class="wz-actions">
        <button class="wz-btn wz-btn--primary" onClick={onContinue}>
          I've queued the reconnects →
        </button>
      </div>
    </div>
  );
}

// ─── Step 5: Done ────────────────────────────────────────────────────

function StepDone(props: { result: RestoreResult; onExit: () => void }): preact.JSX.Element {
  const { result, onExit } = props;
  return (
    <div class="wz-step wz-step--done">
      <TubeIcon name="filament-active" size={56} />
      <h2 class="wz-step-title wz-step-title--done">Restored.</h2>
      <p class="wz-step-lede">
        {result.restoredInstances} Miniflux instance{result.restoredInstances === 1 ? '' : 's'},{' '}
        {result.restoredMappings} mapping{result.restoredMappings === 1 ? '' : 's'}, and{' '}
        {result.restoredHistory} history row{result.restoredHistory === 1 ? '' : 's'} came back.
      </p>
      <a class="wz-btn wz-btn--primary" href="/dashboard" onClick={onExit}>
        Return to dashboard
      </a>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

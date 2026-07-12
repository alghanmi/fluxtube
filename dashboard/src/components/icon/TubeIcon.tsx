/**
 * TubeIcon — the Phase 10 icon set for the FluxTube dashboard.
 *
 * Fourteen glyphs, one component. SVG paths + color mapping are ported
 * verbatim from the design bundle's TubeIcon.dc.html; do not edit paths
 * without updating the source-of-truth handoff artifact.
 *
 * Colors flow through the dashboard's CSS variables so token changes
 * (`--color-*` in `global.css`) propagate automatically. The amber
 * drop-shadow on `filament-active` uses a literal rgba because SVG's
 * `filter` attribute needs a resolvable value at render time.
 *
 * The `live-fetch` pulse animation is defined in `global.css`
 * (`.ti-pulse` + `@keyframes ti-pulse-ring`) and respects
 * `prefers-reduced-motion`.
 */
import type { JSX, SVGAttributes } from 'preact';
type SVGProps = Omit<SVGAttributes<SVGSVGElement>, 'name'>;

export type TubeIconName =
  | 'filament-active'
  | 'filament-idle'
  | 'filament-error'
  | 'rss-node'
  | 'playlist-node'
  | 'flow-line'
  | 'save'
  | 'discard'
  | 'add'
  | 'remove'
  | 'duplicate'
  | 'encrypted'
  | 'live-fetch'
  | 'backup-fresh'
  | 'backup-stale';

export type TubeIconVariant = 'default' | 'muted' | 'active';

export interface TubeIconProps extends SVGProps {
  name: TubeIconName;
  size?: number;
  variant?: TubeIconVariant;
  /** Overrides the derived color for the icon's main stroke/fill. */
  color?: string;
  /** Accessible label; when omitted the icon renders as decorative. */
  title?: string;
}

// Fallbacks in the var() expressions keep the icons rendering correctly
// even when consumed on branches that don't yet define the Phase 10
// additions (--color-accent-glow / --color-danger-strong / --color-success).
// Existing tokens (--color-fg, --color-fg-muted, --color-line-strong,
// --color-accent, --color-bg-elevated) have always been in global.css.
const T = {
  ink: 'var(--color-fg)',
  inkMuted: 'var(--color-fg-muted)',
  line: 'var(--color-line-strong)',
  accent: 'var(--color-accent)',
  glow: 'var(--color-accent-glow, #f2b45c)',
  danger: 'var(--color-danger-strong, #9c2f1f)',
  success: 'var(--color-success, var(--color-green, #9bbf6f))',
  bg: 'var(--color-bg-elevated)',
};

function resolveMainColor(name: TubeIconName, variant: TubeIconVariant): string {
  if (name === 'filament-active') return T.glow;
  if (name === 'filament-idle') return T.line;
  if (name === 'filament-error') return T.danger;
  if (name === 'flow-line' || name === 'rss-node' || name === 'playlist-node') {
    return variant === 'active' ? T.accent : T.inkMuted;
  }
  if (name === 'live-fetch') return T.glow;
  if (name === 'backup-fresh') return T.success;
  if (name === 'backup-stale') return T.inkMuted;
  if (
    name === 'save' ||
    name === 'discard' ||
    name === 'add' ||
    name === 'remove' ||
    name === 'duplicate' ||
    name === 'encrypted'
  ) {
    return variant === 'muted' ? T.inkMuted : T.ink;
  }
  return T.inkMuted;
}

function renderGlyph(name: TubeIconName, main: string) {
  switch (name) {
    case 'filament-active':
      return (
        <path
          d="M5 17 C5 9 8 6 12 8 C16 10 12 14 9.5 12 C8 10.7 9.5 8.7 11.5 9.3 C15 10.3 17 12 17 17"
          stroke={main}
          strokeWidth="1.6"
          strokeLinecap="round"
          fill="none"
          style={{ filter: 'drop-shadow(0 0 3px rgba(242,180,92,0.65))' }}
        />
      );
    case 'filament-idle':
      return (
        <path
          d="M5 17 C5 9 8 6 12 8 C16 10 12 14 9.5 12 C8 10.7 9.5 8.7 11.5 9.3 C15 10.3 17 12 17 17"
          stroke={main}
          strokeWidth="1.6"
          strokeLinecap="round"
          fill="none"
        />
      );
    case 'filament-error':
      return (
        <>
          <path
            d="M5 17 C5 11 7 8 9.5 8.5 C11.2 8.85 11 10.6 10 11"
            stroke={main}
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M13.5 9 C15.8 8 18 9.5 18 14 C18 16.5 17 18 15 18"
            stroke={main}
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="11.7" cy="10.3" r="1.4" fill={T.danger} />
        </>
      );
    case 'rss-node':
      return <circle cx="12" cy="12" r="3.2" fill={main} />;
    case 'playlist-node':
      return (
        <>
          <rect x="6" y="7" width="12" height="2.6" rx="1" fill={main} />
          <rect x="6" y="10.7" width="12" height="2.6" rx="1" fill={main} opacity="0.75" />
          <rect x="6" y="14.4" width="8" height="2.6" rx="1" fill={main} opacity="0.5" />
        </>
      );
    case 'flow-line':
      return (
        <>
          <path d="M3.5 12 L18 12" stroke={main} strokeWidth="1.6" strokeLinecap="round" />
          <path
            d="M14.5 8.5 L18.5 12 L14.5 15.5"
            stroke={main}
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case 'save':
      return (
        <>
          <path d="M12 4.5 L12 14.5" stroke={main} strokeWidth="1.6" strokeLinecap="round" />
          <path
            d="M7.5 11 L12 15.5 L16.5 11"
            stroke={main}
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M5 18.5 L19 18.5" stroke={main} strokeWidth="1.6" strokeLinecap="round" />
        </>
      );
    case 'discard':
      return (
        <>
          <path d="M6.5 6.5 L17.5 17.5" stroke={main} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M17.5 6.5 L6.5 17.5" stroke={main} strokeWidth="1.6" strokeLinecap="round" />
        </>
      );
    case 'add':
      return (
        <>
          <path d="M12 5.5 L12 18.5" stroke={main} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M5.5 12 L18.5 12" stroke={main} strokeWidth="1.6" strokeLinecap="round" />
        </>
      );
    case 'remove':
      return <path d="M5.5 12 L18.5 12" stroke={main} strokeWidth="1.6" strokeLinecap="round" />;
    case 'duplicate':
      return (
        <>
          <rect
            x="4.5"
            y="7.5"
            width="10"
            height="10"
            rx="1.2"
            stroke={main}
            strokeWidth="1.5"
            fill="none"
          />
          <rect
            x="8.5"
            y="4.5"
            width="10"
            height="10"
            rx="1.2"
            stroke={T.bg}
            strokeWidth="2.4"
            fill={T.bg}
          />
          <rect
            x="8.5"
            y="4.5"
            width="10"
            height="10"
            rx="1.2"
            stroke={main}
            strokeWidth="1.5"
            fill="none"
          />
        </>
      );
    case 'encrypted':
      return (
        <>
          <circle cx="8.5" cy="9" r="3" stroke={main} strokeWidth="1.5" fill="none" />
          <path d="M10.7 11.2 L18 18.5" stroke={main} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M15.2 15.5 L17 13.7" stroke={main} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M16.6 17 L18.3 15.3" stroke={main} strokeWidth="1.5" strokeLinecap="round" />
        </>
      );
    case 'live-fetch':
      return (
        <>
          <circle
            class="ti-pulse"
            cx="12"
            cy="12"
            r="3"
            stroke={main}
            strokeWidth="1.3"
            fill="none"
          />
          <circle cx="12" cy="12" r="2.6" fill={main} />
        </>
      );
    case 'backup-fresh':
      return <rect x="6" y="6" width="12" height="12" rx="1.5" fill={main} />;
    case 'backup-stale':
      return (
        <rect
          x="6"
          y="6"
          width="12"
          height="12"
          rx="1.5"
          stroke={main}
          strokeWidth="1.6"
          fill="none"
        />
      );
    default:
      return null;
  }
}

const BASE_STYLE = { display: 'block', flexShrink: 0 } as const;

export function TubeIcon(props: TubeIconProps): JSX.Element {
  const { name, size = 24, variant = 'default', color, title, style, ...svgProps } = props;
  const main = color ?? resolveMainColor(name, variant);
  const accessibleProps: Partial<SVGProps> = title
    ? { role: 'img' as const, 'aria-label': title }
    : { 'aria-hidden': true, focusable: 'false' };
  // Only merge the caller's style when it's a plain object; string/signal
  // values pass through unchanged so callers keep whatever shape they set.
  const mergedStyle =
    style && typeof style === 'object' && !('peek' in style)
      ? { ...BASE_STYLE, ...(style as Record<string, unknown>) }
      : (style ?? BASE_STYLE);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={mergedStyle}
      {...accessibleProps}
      {...svgProps}
    >
      {title ? <title>{title}</title> : null}
      {renderGlyph(name, main)}
    </svg>
  );
}

export default TubeIcon;

import type { SVGProps } from 'react';
import { useId } from 'react';

type ValidTeamLogoProps = SVGProps<SVGSVGElement> & {
  compact?: boolean;
  /**
   * `brand` (default) — ruby tile mark, theme-agnostic.
   * `mono` — single-colour outline variant driven by `currentColor`, for
   * contexts that already carry brand colour (footer, inverted rails).
   */
  variant?: 'brand' | 'mono';
};

/**
 * ValidTeam mark: two porcelain strokes converging on a single filled vertex,
 * each stroke capped by a node. It encodes the product's own hierarchy —
 * people (the nodes) and teams (the strokes) resolving into one accountable
 * result (the vertex).
 *
 * Brand colours are hex literals on purpose: the mark must stay identical
 * across `data-theme` accents and light/dark mode, and must match the static
 * assets in `public/icon.svg`, `public/icons/*` and the app icons.
 *
 * Geometry must stay in sync with those static assets.
 */
export function ValidTeamLogo({
  compact = false,
  variant = 'brand',
  className,
  ...props
}: ValidTeamLogoProps) {
  const size = compact ? 28 : 36;
  // Namespace gradient ids per instance so multiple logos on one page don't collide.
  const baseId = useId().replace(/:/g, '');
  const tileId = `${baseId}-tile`;
  const sheenId = `${baseId}-sheen`;

  // The converging stroke, drawn as a single path so brand and mono variants
  // can never drift apart.
  const chevron = 'M7.4 6.6 12 17.4 16.6 6.6';

  if (variant === 'mono') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={className}
        {...props}
      >
        <rect
          x="1.5"
          y="1.5"
          width="21"
          height="21"
          rx="5.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path
          d={chevron}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="17.9" r="1.5" fill="currentColor" />
        <circle cx="7.4" cy="5.7" r="1.05" fill="currentColor" />
        <circle cx="16.6" cy="5.7" r="1.05" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <defs>
        <linearGradient id={tileId} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#B32038" />
          <stop offset="100%" stopColor="#8C1729" />
        </linearGradient>
        <radialGradient
          id={sheenId}
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(5 4) rotate(48) scale(22)"
        >
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.26" />
          <stop offset="55%" stopColor="#FFFFFF" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Base brand tile */}
      <rect x="1" y="1" width="22" height="22" rx="5.6" fill={`url(#${tileId})`} />
      {/* Top-left inner sheen for depth */}
      <rect x="1" y="1" width="22" height="22" rx="5.6" fill={`url(#${sheenId})`} />
      {/* Crisp inner edge so the mark reads at small sizes */}
      <rect
        x="1.6"
        y="1.6"
        width="20.8"
        height="20.8"
        rx="5"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.2"
        strokeWidth="0.8"
      />
      {/* Two strokes converging on the result */}
      <path
        d={chevron}
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The result */}
      <circle cx="12" cy="17.9" r="1.6" fill="#FFFFFF" />
      {/* People */}
      <circle cx="7.4" cy="5.7" r="1.05" fill="#FFFFFF" opacity="0.92" />
      <circle cx="16.6" cy="5.7" r="1.05" fill="#FFFFFF" opacity="0.92" />
    </svg>
  );
}

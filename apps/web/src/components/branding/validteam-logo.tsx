import type { SVGProps } from 'react';

type ValidTeamLogoProps = SVGProps<SVGSVGElement> & {
  compact?: boolean;
  /**
   * `brand` (default) — bordeaux bowtie mark, theme-agnostic.
   * `mono` — single-colour variant driven by `currentColor`, for
   * contexts that already carry brand colour (footer, inverted rails).
   */
  variant?: 'brand' | 'mono';
};

/**
 * ValidTeam mark: the bordeaux "bowtie" — four converging quadrants separated
 * by a porcelain cross and an inward-facing diamond. Geometry mirrors
 * `public/icon.svg` and the PNG assets in `public/icons/*` and the app icons.
 *
 * Brand colours are hex literals on purpose: the mark must stay identical
 * across `data-theme` accents and light/dark mode, matching the static assets.
 */
const PATHS: readonly string[] = [
  'M 58.5 142.0 L 152.5 50.0 L 505.5 178.0 L 505.5 322.0 L 326.5 500.0 L 196.5 519.0 L 167.5 517.0 L 69.5 181.0 Z',
  'M 555.5 170.0 L 913.5 72.0 L 984.5 89.0 L 869.5 516.0 L 730.5 499.0 L 555.5 320.0 Z',
  'M 73.5 989.0 L 168.5 520.0 L 327.5 549.0 L 506.5 730.0 L 512.5 862.0 L 73.5 992.0 Z',
  'M 555.5 729.0 L 729.5 550.0 L 875.5 565.0 L 983.5 901.0 L 902.5 982.0 L 563.5 874.0 L 555.5 748.0 Z',
];

export function ValidTeamLogo({
  compact = false,
  variant = 'brand',
  className,
  ...props
}: ValidTeamLogoProps) {
  const size = compact ? 28 : 36;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1043 1043"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <g fill={variant === 'brand' ? '#901438' : 'currentColor'}>
        {PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}

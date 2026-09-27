import type { ReactNode } from 'react';
import { ROUTES } from '@/config/brand';

/**
 * Shared layout primitives for the marketing landing page.
 *
 * Server-safe (no hooks, no state) — every section component composes these so
 * the page keeps one container rhythm and one typographic voice. Colors and
 * fonts go through the `--landing-*` tokens scoped by `.landing-dark` in
 * globals.css, and destinations come from the central brand route table so a
 * public link can never drift back to an upstream or dead path.
 */

export function Shell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`mx-auto w-full max-w-[1440px] border-[var(--landing-border)] px-4 sm:px-6 lg:border-x lg:px-10 xl:px-14 ${className}`}
    >
      {children}
    </div>
  );
}

export function Kicker({
  label,
  accentVar,
  center = false,
}: {
  label: string;
  accentVar: string;
  center?: boolean;
}) {
  return (
    <span
      className={`landing-kicker inline-flex items-center gap-2.5 text-[var(--landing-text-subtle)] ${
        center ? 'justify-center' : ''
      }`}
    >
      <span className="flex items-center" aria-hidden="true">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accentVar }} />
        <span className="h-px w-5 bg-[var(--landing-border-strong)]" />
      </span>
      {label}
    </span>
  );
}

export function SectionHeader({
  kicker,
  kickerAccentVar,
  title,
  description,
  compact = false,
}: {
  kicker: string;
  kickerAccentVar: string;
  title: string;
  description: string;
  compact?: boolean;
}) {
  if (!compact) {
    return (
      <div className="grid max-w-5xl gap-5 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-10">
        <div className="pt-1">
          <Kicker label={kicker} accentVar={kickerAccentVar} />
        </div>
        <div>
          <h2 className="landing-title text-balance text-[34px] text-[var(--landing-text-dark)] sm:text-[42px] lg:text-[52px]">
            {title}
          </h2>
          <p className="landing-body mt-4 max-w-2xl text-[15px] text-[var(--landing-text-subtle)] sm:text-[16px]">
            {description}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <Kicker label={kicker} accentVar={kickerAccentVar} />
      <h2 className="landing-title mt-5 text-balance text-[30px] text-[var(--landing-text-dark)] sm:text-[36px]">
        {title}
      </h2>
      <p className="landing-body mt-4 max-w-2xl text-[15px] text-[var(--landing-text-subtle)] sm:text-[16px]">
        {description}
      </p>
    </div>
  );
}

/** Shared brand-colored focus ring — matches the landing showcase idiom. */
export const focusRingClass =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--landing-accent-ruby)]';

/** Canonical primary CTA classes for the landing IBM/Carbon palette. */
export const primaryCtaClass = `inline-flex h-11 items-center gap-2 rounded-md bg-[var(--landing-accent-ruby-solid)] px-4 text-sm font-[450] text-white transition-colors duration-150 hover:bg-[var(--landing-accent-ruby-solid-hover)] ${focusRingClass}`;

/** Canonical secondary (outline) CTA classes. */
export const secondaryCtaClass = `inline-flex h-11 items-center gap-2 rounded-md border border-[var(--landing-border-strong)] bg-[var(--landing-bg-elevated)] px-4 text-sm font-[450] text-[var(--landing-text)] transition-colors duration-150 hover:bg-[var(--landing-bg-hover)] ${focusRingClass}`;

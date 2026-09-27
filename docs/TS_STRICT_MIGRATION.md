# TypeScript strictness migration

**Tracking:** QUAL-21 · **Verified:** 2026-08-12

The shared base config enables `strict`, `noUncheckedIndexedAccess`, and
`exactOptionalPropertyTypes`. Package-level exceptions keep the tree green
while older code is migrated.

## Current configuration

| Workspace                | `exactOptionalPropertyTypes` | Contract                                                  |
| ------------------------ | ---------------------------- | --------------------------------------------------------- |
| `@tasknebula/types`      | on                           | Beachhead; new shared types satisfy exact optional shapes |
| `@tasknebula/web`        | temporarily off              | Migrate affected files without adding `any`/suppression   |
| `@tasknebula/db`         | temporarily off              | Resolve Drizzle insert/update optional-vs-null shapes     |
| `@tasknebula/mcp-server` | temporarily off              | Migrate MCP SDK payload/build shapes                      |

The opt-outs live in each workspace `tsconfig.json` with a QUAL-21 comment.
Do not copy an opt-out to another package or turn the base flag off.

## Correct migration patterns

With exact optional properties, `foo?: string` means the property may be
absent; it does not automatically mean `{ foo: undefined }` is accepted.

Prefer omission when the value is absent:

```ts
interface Input {
  label?: string;
}

const input: Input = {
  ...(maybeLabel !== undefined ? { label: maybeLabel } : {}),
};
```

Widen to `label?: string | undefined` only when an explicitly present
`undefined` value is part of the real runtime/API contract. Narrow before
assignment when absence is invalid.

Do not “fix” errors with `any`, broad casts, `@ts-ignore`, or by weakening a
domain type. For Drizzle, distinguish nullable SQL columns (`null`) from an
omitted update value (`undefined`).

## Tranche workflow

1. Select one workspace or a coherent group of marked files.
2. Temporarily enable `exactOptionalPropertyTypes` for that workspace and run
   its type-check to capture a fresh error inventory. Do not rely on a dated
   count in documentation.
3. Fix call sites and types according to runtime semantics.
4. Run focused tests plus workspace/repo type-check and lint.
5. Remove obsolete `QUAL-21 TS-strict-migration` file headers as files become
   clean.
6. Remove the workspace opt-out only when its full type-check succeeds with the
   flag inherited from the base config.

If a large tranche must stay queued, the only accepted file marker is:

```ts
// QUAL-21 TS-strict-migration: exact optional properties pending.
// See docs/TS_STRICT_MIGRATION.md.
```

Do not embed an error count in the marker; counts drift with unrelated type
changes.

## Completion

QUAL-21 is complete when no workspace overrides
`exactOptionalPropertyTypes`, repo type-check/lint/tests pass, and remaining
explicit `any` usage has a separately justified domain boundary or is removed.

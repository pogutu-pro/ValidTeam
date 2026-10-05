# ValidTeam Agentic Workbench Redesign

This file is the execution ledger for the full web-interface redesign requested
on 2026-08-20. It is intentionally route-complete, implementation-oriented,
and safe for a public repository. It contains no deployment or operator data.

## Outcome

Rebuild ValidTeam as a calm, keyboard-first **agentic workbench**: a product
where people can see what needs judgment, what an agent is doing, what effect
is proposed, and what has actually been applied—without turning every screen
into a chat interface or a wall of cards.

The work is complete only when every route in `apps/web/design-route-manifest.json`
has been reviewed in the new system and the full local quality gate passes.

## Original redesign-pass constraints

- [x] Keep the initial redesign pass local. A later, explicit operator request
      separately authorized a hosted preview; the current functional audit is
      local again and does not carry implicit deployment authorization.
- [x] Preserve product behavior, authorization, tenancy, approval gates, and
      durable runtime truth; a visual redesign must not imply unfinished agent
      capabilities are live.
- [x] Keep every new user-facing string in `next-intl` and maintain real
      translations across all 30 locale catalogs.
- [x] Preserve first-class light, dark, reduced-motion, keyboard, touch, and RTL
      behavior.
- [x] Keep ValidTeam's IBM Plex workbench identity, single action blue,
      square-ish geometry, and accountable work-topology signature.
- [x] Do not copy proprietary assets, wording, icons, or one-to-one layouts from
      competitors. Synthesize interaction principles into ValidTeam's own system.
- [x] No decorative AI tropes: purple gradients, glowing orbs, glass panels,
      animated thinking stars, ornamental graphs, or confidence scores without
      a real source.
- [x] No generic dashboard tropes: equal-weight KPI card grids, cards inside
      cards, redundant headings, badge soup, icon tiles above headings, or
      excessive borders and shadows.

## Research and evidence

- [x] Read repository product, frontend, design-system, i18n, and private local
      operating constraints.
- [x] Inventory all 56 page routes and the shared shell/component ownership graph.
- [x] Review Impeccable's live site, “Worlds” model, repository, DESIGN/PRODUCT
      contracts, distill/typeset/polish/audit playbooks, and deterministic
      anti-pattern detector architecture.
- [x] Review Linear's 2026 visual refresh: receded navigation, compact tabs,
      reduced icon treatment, and structure that is felt rather than seen.
- [x] Review Linear's agent model: human accountability remains primary while
      an agent is a visible delegate/contributor with attributable activity.
- [x] Review Plane Navigation 2.0: global vs project context, customizable and
      collapsible chrome, focused project workspaces, and a unified command surface.
- [x] Review Plane's agentic-workflow model: state, approvals, activity trail,
      transparent plan-before-apply, and explicit failure modes.
- [x] Review Jira's current navigation and Summer 2026 direction: customizable
      sidebar, search/create/AI utilities, rebuilt views, and AI-native work items.
- [x] Review Codex, Devin, Notion Agents, and Rovo patterns: long-running threads,
      child work, waiting-for-human states, review queues, scoped tools/access,
      schedules/triggers, and audit/version history.
- [x] Capture the public landing baseline in the isolated local dev server and
      verify meaningful content with no framework error overlay.
- [x] Capture authenticated baseline evidence from a disposable, isolated test
      fixture; never use real user data for design screenshots.

## Committed design direction

### 1. Workbench shell

- [x] Make the work canvas visually dominant and reduce navigation contrast.
- [x] Keep the global rail destination-only, quiet, tooltip-backed, and
      keyboard accessible.
- [x] Make the context panel answer “where am I working?” rather than duplicate
      global destinations.
- [x] Consolidate global search, create, command, notifications, and agent entry
      points into one predictable command bar.
- [x] Keep project navigation in one canonical location and allow focused/collapsed
      working modes without hiding critical orientation.
- [x] Recompose the shell for mobile instead of shrinking desktop chrome.
- [x] Use logical properties so rail, context panel, drawers, and indicators
      work correctly in Arabic and Hebrew.

### 2. Agentic interaction model

- [x] Represent agents as accountable collaborators attached to work records,
      not as a decorative global chatbot.
- [x] Keep a human owner visible when work is delegated to an agent.
- [x] Standardize agent/run states: queued, running, waiting for input, proposed,
      approval required, applying, applied, failed, cancelled, and reverted.
- [x] Surface “waiting for you” separately from passive notifications and
      ordinary assigned work.
- [x] Show scope, source coverage, proposed effects, review state, and durable
      apply state where the backend exposes them.
- [x] Never imply that a project-agent preview mutated work when the durable
      approval/apply worker does not support that effect.
- [x] Keep request -> evidence -> plan -> proposed effect -> review -> apply ->
      release legible as a reusable evidence path on relevant detail surfaces.
- [x] Make agent activity filterable and inspectable from the same work views
      people already use.

### 3. Visual system

- [x] Tighten the neutral canvas/surface ramp in both themes and retain one
      primary action blue.
- [x] Standardize workbench typography roles: page identity, section title,
      body, control, metadata, identifier, and numeric evidence.
- [x] Use tabular numerals for metrics, comparisons, dates, estimates, and counts.
- [x] Reduce generic card use; prefer one accountable surface with rows, sections,
      tonal insets, or whitespace.
- [x] Reduce divider count and soften remaining separators.
- [x] Keep controls at 4px radius, substantial surfaces at 6px, compact metadata
      at 2px, and circular treatment only for genuinely circular objects.
- [x] Keep icons at consistent 16/18px workbench sizes and remove redundant icons.
- [x] Use property-specific 150–200ms transitions and preserve useful reduced-motion
      state feedback.
- [x] Normalize loading skeleton geometry so it matches final content and does
      not introduce layout shifts.
- [x] Define intentional empty, unavailable, permission, error, conflict, offline,
      success, and retry treatments.

## Shared implementation owners

### Tokens and primitives

- [x] Refine semantic light/dark workbench tokens in `src/app/globals.css` and
      keep `DESIGN_SYSTEM.md` synchronized.
- [x] Simplify legacy dashboard-only overrides; shared primitives must own the
      new visual language.
- [x] Refine `Button`, `Card`, `Badge`, `Tabs`, `Input`, `Select`, `Dialog`,
      `Sheet`, `Table`/row patterns, `Skeleton`, and `Tooltip` states.
- [x] Rebuild `PageFrame` around a consistent content grid, density contract,
      and responsive padding.
- [x] Rebuild `PageHeader` with stable title/context/action zones and progressive
      disclosure for secondary actions.
- [x] Add or refine compact summary/evidence-strip primitives without recreating
      an equal-weight KPI grid.
- [x] Add reusable work-state dot/label and evidence-path primitives only if
      existing primitives cannot express the required semantics.

### Shell and navigation

- [x] Simplify `AppSidebar` information architecture and remove duplicated
      destinations/actions.
- [x] Refine `AppRail` active, unread, focus, and profile states.
- [x] Refine `AppHeader` into the single global command surface.
- [x] Align organization/project switchers with explicit mutation scope.
- [x] Rework project context navigation to be compact, stable, and collapsible.
- [x] Rework settings/admin context navigation into clear labeled sections with
      search only where it materially improves findability.
- [x] Recompose `MobileNav`, context detail, and command actions for 320–390px.
- [x] Preserve page-sidebar portals for chat/docs while preventing a fourth
      competing navigation layer.

### Archetype templates

- [x] Overview: one answer/next action, one compact evidence strip, then unequal
      supporting sections.
- [x] Command: one compact view toolbar attached to the list/board/table surface;
      filters and bulk actions appear only when relevant.
- [x] Analysis: explicit scope/range, one primary chart or comparison, direct
      labels, then evidence/detail.
- [x] Detail: identity/state first, primary content second, property/evidence rail
      third, canonical audit/activity access retained.
- [x] Configuration: context navigation + one setting question per section,
      explicit save/pending/success/destructive states.
- [x] Public evidence: editorial rhythm, compact public header, attributable
      product truth, responsive key/value evidence.
- [x] Auth/setup: focused 360–400px form, one honest product proof, clear recovery.
- [x] Recovery/status: semantic state heading, one working recovery action, one
      escape route, preserved context.

## Dashboard: “what needs judgment now?”

- [x] Replace the current multi-widget wall with one dominant attention queue.
- [x] Merge actionable assigned work, blocked work, overdue work, and review-needed
      agent effects into a clear priority order without fabricating precision.
- [x] Keep completed/active/blocked evidence in one subordinate compact strip.
- [x] Convert catch-up and standup from competing cards into contextual actions
      attached to the attention flow.
- [x] Create a restrained “agent watch” area for running/waiting/review states
      using real endpoints and existing governance permissions.
- [x] Keep recent activity and pinned items progressively disclosed or secondary.
- [x] Keep delivery analysis below the operating surface and collapsed until useful.
- [x] Align dashboard loading, empty, partial-error, and no-work states with final
      geometry.
- [x] Verify opening an issue preserves queue position and returns focus on close.
- [x] Verify narrow screens become one ordered stream with no horizontal clipping.

## Route-complete implementation checklist

Each route is complete only after hierarchy, shared-system fit, real actions,
loading/empty/error behavior, responsive composition, keyboard behavior, light/
dark theme, and relevant RTL behavior have been checked.

### Public evidence and landing

- [x] `src/app/page.tsx` — landing / product narrative / real agent-human workflow.
- [x] `src/app/(public)/trust/page.tsx` — attributable security and operations evidence.
- [x] `src/app/(public)/ai-model-cards/page.tsx` — model purpose, data, retention,
      oversight, and limits.
- [x] `src/app/(public)/intake/[slug]/page.tsx` — scoped request intake and recovery.
- [x] `src/app/share/[token]/page.tsx` — shared-document ownership and availability.

### Auth, setup, and recovery

- [x] `src/app/auth/signin/page.tsx`
- [x] `src/app/auth/signup/page.tsx`
- [x] `src/app/auth/forgot-password/page.tsx`
- [x] `src/app/auth/reset-password/page.tsx`
- [x] `src/app/auth/verify-email/page.tsx`
- [x] `src/app/auth/verify-request/page.tsx`
- [x] `src/app/auth/error/page.tsx`
- [x] `src/app/setup/page.tsx`
- [x] `src/app/join/project/[token]/page.tsx`
- [x] `src/app/offline/page.tsx`

### Personal and organization command surfaces

- [x] `src/app/[locale]/(app)/dashboard/page.tsx`
- [x] `src/app/[locale]/(app)/inbox/page.tsx`
- [x] `src/app/[locale]/(app)/my-issues/page.tsx`
- [x] `src/app/[locale]/(app)/issues/page.tsx`
- [x] `src/app/[locale]/(app)/issues/[issueId]/page.tsx`
- [x] `src/app/[locale]/(app)/drafts/page.tsx`
- [x] `src/app/[locale]/(app)/templates/page.tsx`
- [x] `src/app/[locale]/(app)/docs/page.tsx`
- [x] `src/app/[locale]/(app)/team/page.tsx`
- [x] `src/app/[locale]/(app)/initiatives/page.tsx`
- [x] `src/app/[locale]/(app)/initiatives/[id]/page.tsx`

### Projects and planning

- [x] `src/app/[locale]/(app)/projects/page.tsx`
- [x] `src/app/[locale]/(app)/projects/[projectId]/page.tsx`
- [x] `src/app/[locale]/(app)/projects/[projectId]/board/page.tsx`
- [x] `src/app/[locale]/(app)/projects/[projectId]/backlog/page.tsx`
- [x] `src/app/[locale]/(app)/projects/[projectId]/roadmap/page.tsx`
- [x] `src/app/[locale]/(app)/projects/[projectId]/analytics/page.tsx`
- [x] `src/app/[locale]/(app)/projects/[projectId]/chat/page.tsx`
- [x] `src/app/[locale]/(app)/projects/[projectId]/docs/page.tsx`
- [x] `src/app/[locale]/(app)/projects/[projectId]/modules/page.tsx`
- [x] `src/app/[locale]/(app)/projects/[projectId]/views/page.tsx`
- [x] `src/app/[locale]/(app)/projects/[projectId]/sprints/page.tsx`
- [x] `src/app/[locale]/(app)/projects/[projectId]/sprints/[sprintId]/page.tsx`

### Project configuration

- [x] `src/app/[locale]/(app)/projects/[projectId]/settings/page.tsx`
- [x] `src/app/[locale]/(app)/projects/[projectId]/settings/components/page.tsx`
- [x] `src/app/[locale]/(app)/projects/[projectId]/settings/versions/page.tsx`
- [x] `src/app/[locale]/(app)/projects/[projectId]/settings/workflows/page.tsx`

### Organization configuration and administration

- [x] `src/app/[locale]/(app)/settings/page.tsx`
- [x] `src/app/[locale]/(app)/settings/organization/page.tsx`
- [x] `src/app/[locale]/(app)/settings/members/page.tsx`
- [x] `src/app/[locale]/(app)/settings/billing/page.tsx`
- [x] `src/app/[locale]/(app)/settings/integrations/page.tsx`
- [x] `src/app/[locale]/(app)/settings/import/page.tsx`
- [x] `src/app/[locale]/(app)/settings/labels/page.tsx`
- [x] `src/app/[locale]/(app)/settings/sso/page.tsx`
- [x] `src/app/[locale]/(app)/settings/ai-transparency/page.tsx`
- [x] `src/app/[locale]/(app)/settings/intake-forms/page.tsx`
- [x] `src/app/[locale]/(app)/settings/intake-forms/[id]/edit/page.tsx`
- [x] `src/app/[locale]/(app)/settings/security/audit-log-streaming/page.tsx`
- [x] `src/app/[locale]/(app)/admin/page.tsx`
- [x] `src/app/[locale]/(app)/api-docs/page.tsx`

## Cross-surface state and interaction passes

- [x] Loading/pending geometry matches the final route composition.
- [x] Empty states state why the surface is empty and offer at most one primary action.
- [x] Errors name the failed operation and expose retry/recovery without losing context.
- [x] Permission-denied states do not leak data or offer impossible actions.
- [x] Optimistic updates expose durable success or undo/retry; no simulated success.
- [x] Hover-only controls are also reachable on focus and touch.
- [x] Dialog/sheet focus returns to the invoking control.
- [x] URL-backed filters, tabs, density, and selected views survive refresh/back/share.
- [x] Long localized copy, long names, empty values, and large counts do not clip.
- [x] 200% zoom remains usable on representative command, detail, settings, and
      public surfaces.
- [x] Reduced motion preserves location and pending-state meaning.

## Local verification gates

- [x] `pnpm i18n:check`
- [x] `pnpm ui:check`
- [x] Impeccable-compatible deterministic anti-slop scan, with findings manually
      verified rather than blindly suppressed.
- [x] `pnpm --filter @validteam/web type-check`
- [x] `pnpm --filter @validteam/web lint`
- [x] Focused unit tests for changed shared primitives, shell, dashboard, and
      domain components.
- [x] `pnpm --filter @validteam/web test`
- [x] `pnpm --filter @validteam/web tests:e2e:public`
- [x] Authenticated surface suite against a disposable isolated fixture.
- [x] `pnpm --filter @validteam/web build`
- [x] `pnpm hygiene:check`
- [x] `git diff --check`

## Browser evidence matrix

- [x] Desktop light: landing, dashboard, command list, board, issue detail,
      analysis, settings, admin, AI/chat, recovery.
- [x] Desktop dark: same representative archetypes.
- [x] 390px light and dark: same representative archetypes.
- [x] 320px critical flows: auth, dashboard attention queue, issue list/detail,
      settings, intake, recovery.
- [x] RTL (Arabic or Hebrew): shell, command toolbar, issue detail, settings,
      public intake.
- [x] Keyboard: skip link, global command, rail/context navigation, list row,
      filter, detail open/close, approval decision, dialog recovery.
- [x] Pointer/touch: board/list actions, overflow menus, sheets, agent review.
- [x] Axe/console/error-overlay checks on representative routes.
- [x] Final screenshots stay in `/tmp` or ignored `.ui-audit/`; none are committed.

## Verification record — 2026-08-20

This record captures the completed visual-redesign pass at that point in time.
It is not a substitute for the deeper feature/persistence audit below; fresh
failures take precedence over this historical green record until rerun.

- Route review: all 56 manifest pages inspected with the isolated E2E workspace;
  final screenshots remain under `/tmp/validteam-route-audit`.
- Authenticated browser contract: all 43 product surfaces passed in desktop-light
  and 390px mobile-dark; the direction-sensitive subset also passed at 320px RTL.
- Public browser contract: 88/88 checks passed across light/dark, 390px, 320px,
  and RTL, including auth, recovery, intake, trust, model-card, share, and offline
  states.
- Interaction contract: 10/10 Chromium flows passed, including keyboard focus
  return, command/AI invocation, mobile layout, durable Kanban movement, and the
  complete issue lifecycle.
- Accessibility evidence: the route suites found no serious/critical axe issue,
  same-origin HTTP failure, browser error, or document-level horizontal overflow.
- Manual accessibility evidence: skip-link transfer, persisted context collapse,
  command and issue-detail focus return, reduced motion, and 720px CSS viewport
  (200% desktop equivalent) passed on representative overview, command, detail,
  configuration, public, and auth surfaces.
- Unit/integration evidence: 301/301 Jest suites passed; 1,883 tests passed and
  one existing test remained intentionally skipped.
- Static/build evidence: type-check, lint (zero errors; existing warning baseline),
  all 30 i18n catalogs (5,828 keys each), UI contract, production build, repository
  hygiene, and diff whitespace checks passed.
- Anti-slop evidence: the current Impeccable detector found only the two retained
  Plus Jakarta `@font-face` declarations used by the optional classic appearance;
  the default workbench/public identity is IBM Plex. The findings were manually
  reviewed rather than suppressed.
- Handoff at the time of this record: the browser-verified local development
  preview ran on `http://localhost:3012`. A later explicitly authorized hosted
  preview occurred outside this local-only pass.

## Visual-redesign completion record

- [x] Every route checkbox above is complete.
- [x] No unresolved P0/P1/P2 design or implementation-integrity finding remains.
- [x] Navigation is quieter than work and the initial dashboard viewport has one
      unmistakable focal point.
- [x] Agent states, human ownership, proposed effects, and applied effects are
      distinguishable wherever applicable.
- [x] All quality gates pass locally.
- [x] The local dev server is browser-verified and ready for the owner to review.
- [x] The original local-only redesign pass itself did not deploy or publish.

## Functional completion audit — 2026-08-20 (closed at release cutoff)

The owner subsequently expanded the scope from visual route coverage to a
feature-complete product audit: every important action must travel from UI to
API to durable data and back to refreshed UI, while administrator controls must
change runtime behavior rather than merely save form values. This section is
the authoritative active ledger. A rendered page or mocked provider is not
accepted as proof that a feature works.

The owner stopped this expanded audit on 2026-08-20 and requested a release
cut from the verified work already present. Unchecked items below are retained
as explicit follow-up backlog; they are not release claims and were not silently
converted to completed work.

### Isolation and fresh baseline

- [x] Create disposable PostgreSQL/Redis fixtures and apply all migrations;
      never reset, seed, or mutate the hosted persistent database.
- [x] Re-run i18n parity, UI contract, hygiene, type-check, lint, Jest, and the
      first Chromium baseline against the isolated fixture.
- [x] Treat optional assertions, caught UI failures, and provider stubs as
      coverage disclosures—not as end-to-end feature proof.
- [x] Reproduce and fix the cold-session command-palette race that hid “Ask AI”
      until the client organization store finished loading; focused Chromium
      flow now passes 3/3.
- [ ] Finish the fresh desktop-light, mobile-dark, and 320px RTL route matrices
      after all functional changes; retain zero hydration, console, HTTP, axe,
      overflow, and missing-state errors.

### Administrator controls must be enforceable

- [x] Re-check durable user status at the canonical server auth boundary so an
      administrator deactivation invalidates an existing JWT session instead of
      waiting for token expiry.
- [x] Require an active user and active, non-suspended organization at shared
      organization/project/document access boundaries; stale project membership
      no longer preserves read or management access.
- [x] Exclude suspended organizations from the normal organization switcher and
      reject organization-bound API keys while their organization is suspended.
- [x] Make Admin → System → Storage operational: complete DB S3 config, DB local
      directory, environment fallback, and safe default are resolved by one
      attachment backend.
- [x] Route issue/document upload, authenticated/public download, and physical
      deletion through that backend; sanitize generated names, prevent traversal
      and overwrite, clean up blobs after DB failure, and sandbox served content.
- [x] Add local and mocked-S3 lifecycle tests plus storage-resolution tests.
- [ ] Prove user deactivation and organization suspension through admin UI → API
      → PostgreSQL → a second authenticated browser/session, including audit log.
- [ ] Audit and migrate every remaining route that performs custom membership
      queries so no suspended-organization bypass remains outside shared guards.
- [ ] Protect self-administration and last-active-super-admin invariants for
      deactivation, demotion, and deletion under concurrent requests.
- [ ] Give feature flags named product consumers (or clearly constrain the UI to
      developer-controlled keys); prove plan, organization, percentage, disabled,
      missing, and suspended-organization behavior.
- [ ] Exercise every admin tab's create/update/delete, validation, permission,
      error, persistence, refresh, and system-audit behavior in the browser.

### Core product flows and persistence

- [ ] Replace the Kanban E2E's caught drag/drop + API fallback with a required
      pointer/keyboard UI move whose persisted column survives reload.
- [ ] Make issue comments a required lifecycle assertion rather than an optional
      endpoint probe; prove create, edit/delete policy where supported, and reload.
- [ ] Prove issue create/edit/status/assignment/labels/attachments/watchers/links,
      bulk operations, saved views, filters, pagination, and tenant-negative cases.
- [ ] Prove backlog, sprint, workflow, component, version/release, module, roadmap,
      initiative, analytics, template, draft, and intake flows with durable reload.
- [ ] Prove organization/project member roles and granular overrides with owner,
      admin, member, viewer, guest, removed member, inactive user, wrong tenant,
      suspended organization, session, and API-key actors.
- [ ] Prove docs spaces/pages/revisions/backlinks/public share/attachments and chat
      messages/threads/files/realtime fallback without mocked success.
- [ ] Prove inbox, notifications, notification preferences, standup/catch-up,
      realtime/presence, exports/import jobs, webhooks, audit sinks, API keys,
      SSO/OAuth, email, LiveKit, and provider failure/retry modes where configured.
- [ ] Prove AI/agent control from platform → organization → project: global kill,
      credentials, runners, agent policy, disclosure, budgets, approval request,
      approve/reject/expiry, durable effect/outbox, failure, cancel, and audit.

### Final release gates for this expanded audit

- [ ] No user-facing string introduced outside `next-intl`; all 30 catalogs pass
      exact ICU/key parity and representative long-copy/RTL checks.
- [ ] React best-practices review passes for all edited TSX, including server/client
      boundaries, stable derived state, accessibility, and avoidable rerenders.
- [ ] Focused tests, full Jest, MCP tests, Chromium flows, full route matrices,
      type-check, lint, production build, UI/i18n/hygiene, and diff checks all pass
      after the final code change.
- [ ] `docs/STATUS.md`, this ledger, and implementation agree; no known unfinished
      behavior is described as complete and no soft/mock check is reported as real.
- [ ] Do not deploy this expanded audit until the owner gives fresh explicit
      authorization after the final local evidence is available.

## v0.17.0 release wrap-up — 2026-08-20

- [x] Freeze the expanded audit without overstating unfinished coverage.
- [x] Remove disposable functional-audit data, browser sessions, and local
      PostgreSQL/Redis containers.
- [x] Bump package, desktop Compose, OpenAPI, changelog, and status references
      to `0.17.0`.
- [x] Pass the canonical release quality gate after the final source change.
- [x] Create the local `chore(release): v0.17.0` commit with the canonical author.
- [x] Publish `neuraparse/validteam:0.17.0` and `latest` for `linux/amd64`, then
      verify the registry digest.
- [x] Keep the hosted environment unchanged; this release authorization covers
      Docker Hub publication, not a live restart or deployment.

## v0.17.1 live-release correction — 2026-08-20

- [x] Catch the stale `0.16.0` Docker pin example during the authorized live
      visual smoke test without moving the immutable `v0.17.0` release refs.
- [x] Replace the numeric landing-page example with the version-neutral
      `X.Y.Z` release-tag placeholder in all 30 locale catalogs.
- [x] Bump package, desktop Compose, OpenAPI, changelog, and status references
      to `0.17.1`.
- [x] Pass the canonical release quality gate after the correction.
- [x] Commit and publish the immutable `v0.17.1` source commit and annotated tag
      to GitHub.
- [x] Stop the `v0.17.1` Docker/live rollout after operator feedback; do not move
      its immutable Git refs and supersede it with the navigation-restoration
      patch below.

## v0.17.2 configuration-access restoration — 2026-08-20

- [x] Inventory every organization, project, and platform-administration route;
      distinguish deleted behavior from hidden or orphaned navigation.
- [x] Keep the desktop context panel available throughout Settings and Admin,
      even when the normal work context was previously collapsed.
- [x] Restore discoverable links to every real organization-settings surface,
      including integrations, import, intake forms, SSO/SCIM, and audit streaming,
      without exposing permission-gated controls to unauthorized users.
- [x] Make project settings a visible, permission-aware full-page destination;
      preserve every existing project configuration tab and deep link.
- [x] Give super admins explicit Admin and Updates entry points from Settings,
      and keep every admin tab reachable on desktop and mobile.
- [x] Add regression coverage for expanded/collapsed navigation, permissions,
      locale-prefixed paths, mobile selection, and project-settings access.
- [x] Pass i18n, UI, hygiene, docs, type-check, lint, full tests, OpenAPI drift,
      production build, React review, and browser checks at 320/390/desktop in
      light, dark, and representative RTL layouts.
- [x] Cut and publish the next patch release to GitHub and Docker Hub, preserve a
      rollback image and fresh database backup, recreate only `web`, then verify
      live health and the restored settings/admin/project-settings journeys.

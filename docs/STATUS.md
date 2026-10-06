# ValidTeam project status

**Verified:** 2026-08-20 · **Version:** 0.17.3 · **Lifecycle:** active internal
product owned by StratNovo

This is the only live capability snapshot. Future work belongs in
[`ROADMAP_2026.md`](ROADMAP_2026.md); released history belongs in
[`../CHANGELOG.md`](../CHANGELOG.md).

## Checked tree inventory

The values below are a dated inventory, not agent instructions:

| Surface                                    | 2026-08-20 tree |
| ------------------------------------------ | --------------: |
| Next.js API `route.ts` files               |             274 |
| Drizzle `pgTable` definitions              |             120 |
| Schema files excluding the re-export index |              55 |
| Journaled SQL migrations                   |              68 |
| Web Jest test files                        |             342 |
| Playwright spec files                      |               9 |
| Locale catalogs                            |              30 |

## Working product areas

- Core project management: organization/project membership, issues, comments,
  links, subtasks, custom fields, attachments, boards, backlog, sprints,
  initiatives, intake, time tracking, releases/versions, components, labels,
  resolution, imports, and analytics surfaces.
- Realtime: organization-scoped SSE with Redis fan-out when configured;
  Tiptap/Yjs collaboration through Hocuspocus with Postgres persistence and
  Redis scale-out.
- AI/provider foundations: OpenAI and Anthropic project-agent adapters, BYOK
  credential resolution, cost audit/guard on covered paths, Ask workspace RAG,
  triage/planning, standup/janitor jobs, and coding-agent session integrations.
- Ask grounding: one canonical `[TN-…]` / `[DOC-…]` citation grammar, unresolved
  marker reporting, SSE source/citation events, and Sidecar citation links.
- Agent safety/runtime foundation: approval-gated project mutations fail closed
  to preview; project agents use a durable bounded graph with idempotent UTC
  admission, checkpoints/events, leased recovery/cancellation and fenced
  database effects; local Claude/Codex subprocesses receive an allowlisted
  environment. The separate research topology has focused library tests.
- Meetings: a project-independent area (instant, scheduled and recurring
  meetings; members and external guests) on the existing LiveKit server. Guests
  join without an account through hashed, expiring, revocable per-meeting
  tokens. Attendance is recorded as sessions from signed LiveKit webhooks with
  server-side LiveKit reconciliation (rejoins and simultaneous tabs are merged,
  never `last_leave - first_join`); statistics and organization/personal
  analytics are computed from those sessions. Invitation, 30-minute reminder,
  30-minute no-show and post-meeting summary emails use the existing SMTP
  pipeline through an idempotent claim ledger driven by
  `/api/cron/meetings-tick` (about once a minute). Meeting chat is transient
  LiveKit data-channel chat. Recording, transcription, captions and AI
  summaries are reserved in the schema (`none`) and deliberately not run.
- Enterprise controls: SAML/SCIM lifecycle and scoped tokens, audit/SIEM,
  database-backed LiveKit/SMTP/storage settings, session revocation, trust and
  AI transparency surfaces, and permission/security scheme configuration.
- Configuration access: permission-aware organization, project, and platform
  administration navigation remains discoverable across desktop and mobile;
  Settings and Admin keep their complete context navigation available even
  when the regular work context is collapsed.
- CI: MCP build, i18n parity, public-repository hygiene, UI and documentation
  contracts, OpenAPI drift, type-check, lint, and tests run on pushes and pull
  requests to `main`; browser E2E remains a local/release gate.

## Important limitations

### Trust and enforcement

1. PostgreSQL RLS is not implemented. Tenant isolation depends on explicit
   organization filters and authorization in application code.
2. Issue status writes now converge on one tenant-scoped transition service
   across PATCH/board/MCP, bulk, automation, approved agent actions, remote
   agent webhooks, Slack, and janitor. Exact edges, workflow roles, and project
   transition permission are enforced with row locks and status compare-and-swap.
   Trusted system jobs and superadmins are explicit audited service-level actors.
   A durable workflow-approval queue and
   typed condition/validator/post-action language are not shipped: approval
   requirements and non-empty unsupported policy fail closed with typed codes.
3. Project-agent approval is containment, not a complete queue: guarded runs
   now make zero writes, but proposed project-engine effects are not yet
   persisted and resumed through the issue-write approval worker.
4. Covered issue-write approvals now apply database effects atomically and use
   a durable at-least-once outbox; external realtime/automation consumers still
   need idempotency for end-to-end exactly-once behavior.

### Agent and research maturity

1. Project tracking, triage and sprint planning/creation now persist bounded
   `project-agent-v1` checkpoints and step events and resume through a leased
   reconciler. Admission returns `202` before provider work; tenant-scoped
   cancellation/resume APIs and settings UI controls cover active and recoverable
   runs. This durability does not yet cover Ask research, local coding agents,
   standup, janitor, or every automation surface.
2. Ask is scoped workspace RAG, not deep research. It has no web crawler,
   durable activity history, source snapshots/claim tables, parallel durable
   fan-out, or mid-run refine/interrupt product flow.
3. Project-agent triage and bulk writes now use lease-fenced transactional
   receipts and stale-context checks. Their realtime fan-out is still
   best-effort rather than outbox-backed. Ask and project-plan providers have
   finite timeouts, but budget/cancellation coverage is not uniform across every
   AI path.
4. Coding-agent local execution still runs from the web request process; a
   restart can lose active work even though its secret environment is now
   constrained.

See [`AGENT_RUNTIME.md`](AGENT_RUNTIME.md) for the exact maturity matrix and
definition of a production engine.

### Product and operations seams

- OAuth providers are registered without the complete database-adapter/user
  lifecycle needed for production organization access.
- MCP tooling is present and the current 11-tool REST surface accepts
  organization-bound API keys with active-user/membership and route-permission
  checks. Fine-grained scopes, per-call MCP audit, OAuth/Streamable HTTP, clean
  install proof, and package publication remain incomplete.
- Some configurable permission/security/feature controls are not enforced by
  all consumers.
- Notifications, pagination/virtualization, mounted analytics, import depth,
  and full external-provider/device smoke coverage remain uneven.
- Meetings gaps: no persistent meeting chat, no host mute control, no custom
  recurrence beyond daily/weekly/monthly with interval and count, no provider
  calendar integration (invitations carry an `.ics` file and a Google Calendar
  link only), series-wide edits and adding people to a whole series are not
  supported (cancel works), SMTP provides no open/delivery tracking, and
  meeting emails are English-only like the other transactional mail. A mail
  timeout is terminal rather than retried so a message is never duplicated.
- All 30 locale catalogs have key and ICU-contract parity, but linguistic QA is
  incomplete: the quality signal still finds legacy English-copy candidates in
  non-English catalogs.
- The pgvector Ask leg is intentionally dormant until an organization-safe
  embedder is supplied; lexical retrieval remains the active path.
- Database and Hocuspocus integration coverage is much thinner than web unit
  coverage.

## Current priority

The next release work should converge existing paths rather than add another
parallel agent or workflow surface:

1. durable workflow-approval apply plus typed condition, validator and
   post-action execution on the shipped transition service;
2. extend the durable project-agent runtime to research and other agent surfaces;
3. expand atomic approval/apply coverage and outbox external agent effects;
4. tenant/auth hardening and cross-organization negative tests;
5. source/claim provenance plus replayable research progress;
6. budget, timeout, cancellation, trace, and recovery coverage on every AI path.

The ordered plan and definitions of done are in
[`ROADMAP_2026.md`](ROADMAP_2026.md).

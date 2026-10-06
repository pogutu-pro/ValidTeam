# AI current state

**Status:** fact document. **Audited:** 2026-10-05 · **Version audited:** `0.17.3`.

This is the answer to _"inspect the actual repository before designing."_ It maps
each area of the existing system to what the AI layer can and cannot do today.

**Nothing here is design intent.** For that see
[`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md) and [`AI_VISION.md`](AI_VISION.md).
For the exhaustive, line-cited inventory — every route, table, capability, and
dormant asset — see
[`CURRENT_AI_CAPABILITIES.md`](CURRENT_AI_CAPABILITIES.md). This document is the
map; that one is the evidence.

Counts are dated tree measurements (285 `route.ts`, 120 `pgTable`, 69
journaled migrations, 30 locale catalogs, 11 MCP tools). Re-derive them rather
than copying.

---

## 0. The headline

ValidTeam does not have an AI subsystem missing a chat window. It has **five
disconnected AI subsystems and no shared substrate between them**, and a
**provider layer that does not exist**.

| Question                                                                    | Answer                                                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Does the AI have a shared provider abstraction?                             | ⛔ **No.** 20 hardcoded provider base URLs across 14 files                                        |
| Can an admin add DeepSeek (or any model) by pasting a key in the dashboard? | ⛔ **No.** The dashboard renders exactly two providers, `openai` and `anthropic`                  |
| Can the AI query the database with real data?                               | ✅ **Yes, indirectly** — `/api/ask` already does RAG and structured queries                       |
| Does the AI have a tool registry?                                           | ⛔ **No.** 11 hand-written MCP tools exist, but they are for _external_ clients                   |
| Does the AI have a tool-calling loop?                                       | ⛔ **No.** The project agent is a fixed `load_context → plan → execute` graph with 3 effect types |
| Is there an approval system?                                                | ✅ **Yes**, and it is good — `agent_approval_requests` + effect outbox                            |
| Is there a durable run runtime?                                             | ✅ **Yes** — `agent_runs`, leases, checkpoints, SSE resumption                                    |
| Is there cost control?                                                      | ✅ **Yes** — budgets, reservations, refunds, kill switch                                          |
| Is there an audit trail?                                                    | ✅ **Yes** — `llm_call_audit` is append-only with hash-only prompts                               |
| Is there conversation persistence?                                          | ⛔ **No**                                                                                         |
| Is there memory?                                                            | ⛔ **No**                                                                                         |
| Are there goals?                                                            | ⛔ **No.** `agent_run_kind` has 4 values, none long-lived                                         |
| Is there tenant isolation for the AI?                                       | ⚠️ **Application-level only.** No RLS; `content_embeddings` has no tenant column                  |

**So the programme is activation and unification.** The pieces that are hardest
to build — authority, approvals, durability, cost, audit — already exist. What
is missing is the layer that connects them, and a provider abstraction.

---

## 1. Authentication — what exists

| Area               | Reality                                                                                                           | Mark |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- | ---- |
| Users              | `users` with `is_super_admin boolean notNull default false` (`schema/users.ts:41`)                                | ✅   |
| Sessions           | NextAuth session cookie; `auth()` is the single entry                                                             | ✅   |
| Email verification | Own `email_verification_tokens` (⚠️ a duplicate NextAuth `verification_tokens` table is also declared and unused) | ✅   |
| Organizations      | `organizations` with `settings jsonb`, `plan`, `status`                                                           | ✅   |
| Membership         | `organization_members` with `organization_role` pgEnum                                                            | ✅   |
| Teams              | `team_members` with `team_role` pgEnum (`lead`, `member`)                                                         | ✅   |
| Projects           | `project_members` with `project_role` pgEnum (7 values, below)                                                    | ✅   |
| Admins             | `isSuperAdmin` flag → `SUPER_ADMIN_PERMISSIONS` (owner's set + `system:*`)                                        | ✅   |
| API keys           | `api-keys.ts` — org-scoped, **no scopes field**                                                                   | ⚠️   |
| SSO / SCIM         | Routes exist; SAML nonce is **in-memory** (not HA-safe)                                                           | ⚠️   |

### 1.1 The real role system — do not invent roles

**Organization roles** (`organization_role`):
`owner`, `admin`, `member`, `viewer`, `guest`
(`schema/organizations.ts:7`)

**Team roles** (`team_role`): `lead`, `member`

**Project roles** (`project_role`, `schema/projects.ts:27`):
`product_owner`, `scrum_master`, `tech_lead`, `developer`, `qa_engineer`,
`designer`, `viewer`

⚠️ **There is no `team lead` role at the organization level.** The spec's
"Team Lead" tier maps to **`project_members.role = 'tech_lead'` or
`'product_owner'`/`'scrum_master'`**, or to `team_members.role = 'lead'`. The AI
permission model must compose all three scopes rather than assume one role
system. [`AI_FEATURE_MATRIX.md`](AI_FEATURE_MATRIX.md) does exactly that.

### 1.2 The two coexisting permission systems

| System                 | Shape                                                                                                                                                                                                                                                     | Where                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Coarse permissions** | ~50 string keys: `org:*`, `team:*`, `project:*`, `issue:create`, `issue:assign`, `issue:transition`, `member:*`, `workflow:*`, `sprint:*`, `custom_field:*`, `webhook:*`, `api_key:*`, `system:*`                                                         | `packages/db/src/utils/permissions.ts:241`     |
| **Fine capabilities**  | Per-project flags: `canAssignIssues`, `canEditOwnIssues`, `canCloseIssues`, `canMoveIssues`, `canLinkIssues`, `canManageWorkflow`, `canAddComments`, … grouped by `issue` / `comment` / `attachment` / `watcher` / `member` / `workflow` / `timeTracking` | `packages/db/src/utils/permissions.ts:102–155` |

Both are live and both are consulted. Any AI tool must use the same resolution
the routes use — `hasPermission`, `resolveProjectCapabilityAccess`,
`resolveApiActor`.

⚠️ **`issue_security_levels` and `permission_scheme_grants` are configurable but
never enforced.** Users already trust them. Decide: enforce or delete.

---

## 2. Data — the relevant tables

120 `pgTable` declarations across 57 schema files. The AI-relevant domains:

| Domain             | Tables                                                                                                                                                                                       | Note                                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity           | `users`, `organizations`, `organization_members`, `teams`, `team_members`, `api_keys`, `email_verification_tokens`, ⚠️ `verification_tokens` (dead)                                          |                                                                                                                                                            |
| Work               | `issues`, `issue_comments`, `labels`, `issue_labels`, `attachments`, `custom_fields`, `issue_status_history`, `issue_dependencies`, `priorities`, `issue_relations`                          | `issue_attachments` ⚠️ dead duplicate                                                                                                                      |
| Planning           | `projects`, `project_members`, `sprints`, `sprint_issues`, `project_modules`, `versions`, `components`, `roadmap_*`, `initiatives`                                                           |                                                                                                                                                            |
| Knowledge          | `documents`, `document_pages`, `document_page_revisions`, `collab_documents`, `wiki_*`                                                                                                       | The richest knowledge is **never embedded**                                                                                                                |
| Activity           | `issue_activities`, `notifications`, `notification_preferences`, `pinned_items`                                                                                                              | The retrieval substrate for "what happened"                                                                                                                |
| Automation         | `automation_rules`, `automation_executions`, `workflows`, `workflow_transitions`, `statuses`, `status_categories`                                                                            |                                                                                                                                                            |
| AI substrate       | `agent_runs`, `agent_run_steps`, `agent_run_effects`, `agent_approval_requests`, `agent_approval_effect_outbox`, `agent_providers`, `agent_sessions`, `agent_fingerprints`, `agent_policies` | **The system already exists**                                                                                                                              |
| Cost & audit       | `llm_call_audit`, `llm_usage_stats`, `org_token_budgets`, `audit_logs`, `audit_log_sinks`                                                                                                    |                                                                                                                                                            |
| Vector             | `content_embeddings`, `content_embeddings_queue`, `semantic_search_history`⚠️ dead, `search_suggestions`⚠️ dead                                                                              | See §5                                                                                                                                                     |
| Dead but specified | `resource-management.ts`: `user_capacity`, `workload_snapshots`, `issue_estimations`, `team_allocations`, `capacity_forecasts`, `smart_assignment_rules`                                     | **~500 lines, zero readers.** `smart_assignment_rules` is a 14-column auto-assignment policy engine — exactly what a Team Agent needs, and entirely unused |

⚠️ **No Postgres RLS anywhere** (0 of 69 migrations mention `ROW LEVEL
SECURITY`). Tenancy is application-level `WHERE` clauses. `CLAUDE.md:82` states
this explicitly: _"isolation is app-level WHERE clauses (Postgres RLS is
planned, not implemented — never claim RLS exists)"_.

---

## 3. Backend capabilities — what the AI can already reach

### 3.1 The idiom every AI path must copy

```ts
const actor = await resolveApiActor(request, 'issues:write');
// → { userId, organizationId, role, projectScope, isSuperAdmin }
```

Then, as needed: `resolveOrganizationAccess`,
`resolveProjectCapabilityAccess`, `hasPermission`, and — for any AI-originated
mutation — `guardAgentAction`.

### 3.2 Real substrate the AI should reuse, not rebuild

| Capability            | Reality                                                                                                                                             | Reuse verdict                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Bounded graph runtime | `runBoundedGraph` — declared routes, fails closed on an undeclared edge, leases, checkpoints, heartbeat, SSE                                        | ✅ **The runtime to build on**                                               |
| Durability            | `agent_runs` + `agent_run_effects` with atomic `(runId, effectKey)` claim                                                                           | ✅                                                                           |
| Approvals             | `agent_approval_requests` + `agent_approval_effect_outbox` + `processApprovalEffectOutbox`                                                          | ✅ **Only 3 executors**: `issues:create`, `issues:update`, `comments:create` |
| Policy                | `agent_policies` + evaluator with fail-safe defaults                                                                                                | ⚠️ **Opt-in and self-asserted** — the AI actor comes from the request body   |
| Workflow              | `prepareIssueStatusTransition` / `applyPreparedIssueStatusTransition` — validates the edge, role, project permission, with row locks and status CAS | ✅ **Authoritative.** AI must never bypass it                                |
| Cost                  | `runWithBudget`, `checkAndReserveTokens`, `commitUsage`, `refundReservation`, `org_token_budgets`, daily admission, kill switch                     | ✅ — ⚠️ **not wrapped around the project-agent graph**                       |
| Background            | 7 cron routes: `agent-runs`, `agent-approval-effects`, `standup`, `janitor`, `cycle-rollover`, `embeddings`, `version-check`                        | ✅                                                                           |
| Wakeup                | `pg_notify` + `LISTEN` (used by the embedding worker)                                                                                               | ✅                                                                           |
| Coordination          | Redis, nullable with in-process fallback                                                                                                            | ✅                                                                           |
| Search                | `lib/search/hybrid.ts` — `websearch_to_tsquery('simple')` + `ts_rank_cd`, cosine `<=>`, **RRF k=60**                                                | ✅                                                                           |
| Notifications         | `notifications` + `notification_preferences` (incl. `doNotDisturbStart`)                                                                            | ✅                                                                           |
| Email                 | SMTP + 11 templates                                                                                                                                 | ✅                                                                           |
| Analytics             | 11 preset endpoints + `insight`                                                                                                                     | ✅                                                                           |
| External              | 10 webhook event types with HMAC-SHA256, 12 Slack slash commands, Jira + GitHub OAuth                                                               | ✅                                                                           |
| MCP server            | 11 tools, `resolveApiActor` + org/project scope, `guardAgentAction` delegated to REST                                                               | ✅ **Reuse these, do not write a parallel catalogue**                        |
| Realtime              | Hocuspocus/Yjs in `services/hocuspocus`                                                                                                             | ✅                                                                           |

### 3.3 What does not exist

| Missing                              | Consequence                                |
| ------------------------------------ | ------------------------------------------ |
| Provider abstraction                 | §4                                         |
| Tool registry / tool-calling loop    | Every capability is bespoke                |
| Thread / message persistence         | No continuity                              |
| Memory                               | Nothing survives a run except checkpoints  |
| Goals                                | No long-lived objective                    |
| Schedule field on `automation_rules` | "Every Friday" is impossible               |
| Derived triggers                     | "Becomes overdue" is a query, not an event |
| Reversible effects                   | `agent_run_effects` has no `payload_pre`   |
| Cross-tenant negative tests          | No release gate against leakage            |

---

## 4. Providers and models — the DeepSeek blocker

Verified, exhaustively.

### 4.1 There is no provider abstraction

| Fact                                   | Evidence                                                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20 hardcoded base URLs in 14 files     | `fetch('https://api.openai.com/v1/chat/completions', …)` and `fetch('https://api.anthropic.com/v1/messages', …)`                                           |
| `agent_provider` is a 5-value `pgEnum` | `native \| openai \| anthropic \| azure \| custom` (`schema/agents.ts:39–45`)                                                                              |
| 28 hardcoded catalog entries           | `lib/agents/model-catalog.ts` — GPT and Claude families only                                                                                               |
| Defaults are hardcoded per provider    | `AGENT_PROVIDER_DEFAULT_MODELS`: `native → validteam-planner-v1`, `openai → gpt-4o-mini`, `anthropic → claude-sonnet-4-6`, `azure → gpt-4o`, `custom → ''` |
| The provider ladder is copy-pasted     | Comment in `triage.ts:20` and `embeddings.ts:16` says so in as many words                                                                                  |
| **No DeepSeek anywhere in the repo**   | `grep -ri deepseek` over `apps/web/src`, `packages/db/src`, `packages/mcp-server/src` → 0 hits                                                             |

### 4.2 🔵 An admin cannot add any model beyond two

| #   | Blocker                                                                                                                                                                 | Location                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | Secret store has **two** slots: `CredentialKey = 'openai' \| 'anthropic'`                                                                                               | `lib/agents/credentials.ts:17`                                          |
| 2   | `CREDENTIAL_KEY_FOR_PROVIDER` omits `azure`/`custom` → the resolver returns `null` **before** the env fallback, so `AZURE_OPENAI_API_KEY` is never read                 | `lib/agents/credentials.ts:32–34, 148–158`                              |
| 3   | Status can report `configured: true` (env) while the resolver returns `null`                                                                                            | `lib/agents/credentials.ts:92–158`                                      |
| 4   | The org credential endpoint accepts `z.enum(['openai','anthropic'])` but its write branch handles **`openai` only** — choosing Anthropic returns 200 and stores nothing | `app/api/organizations/[organizationId]/ai-agents/route.ts:49, 317–334` |
| 5   | **`POST /api/admin/agent-control/credentials` does not exist.** The super-admin credentials UI calls it                                                                 | `components/admin/platform-ai-credentials.tsx:30, 40`                   |
| 6   | The dashboard renders a fixed two-provider list                                                                                                                         | `components/admin/platform-ai-credentials.tsx:12, 136`                  |
| 7   | `custom` is selectable but non-functional — no default model, no credential slot                                                                                        | `config.ts:40–46`, `credentials.ts:32–34`                               |

**Encryption itself is sound** and should be reused verbatim: AES-256-GCM,
`iv`/`authTag`/`ciphertext`, key derived from `AUTH_SECRET`, `••••last4` preview.
The defect is the _shape_ — a 2-value union instead of a keyed store — not the
crypto.

The fix is specified in [`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md) §5.4 and
[`AI_MODEL_STRATEGY.md`](AI_MODEL_STRATEGY.md).

---

## 5. Vector infrastructure — what exists

pgvector is real, indexed, and already answering `/api/ask`. This is the
strongest asset in the repository.

| Element               | Reality                                                                                                                                                                                                                | Mark |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Extension             | `vector` column type in use; `vector(1536)` on `content_embeddings.embedding`                                                                                                                                          | ✅   |
| Embedding model       | `text-embedding-3-small` in the pipeline; ⚠️ the schema's `embeddingModel` **defaults to `text-embedding-ada-002`**, which misdescribes real rows                                                                      | ⚠️   |
| Table                 | `content_embeddings` — `contentType`, `contentId`, `issueId`, `commentId`, `projectId`, `contentSnippet`, `metadata`, `embedding`, `embeddingModel`, `embeddingProvider`, `tokensUsed`, `contentHash` (MD5), `version` | ✅   |
| ⚠️ **Tenant column**  | ⛔ **None.** Scoping requires joining to `issues`/`projects`                                                                                                                                                           | ⚠️   |
| Queue                 | `content_embeddings_queue` — `bigserial`, `status` (`pending`/`running`/`done`/`failed`), `attempts`, `lastError`, timestamps; triggers on issue/comment inserts + `pg_notify('content_embeddings_jobs')`              | ✅   |
| Worker                | `/api/cron/embeddings`, MD5 content-hash change detection, `LISTEN` with polling fallback                                                                                                                              | ✅   |
| HNSW index            | `content_embeddings_embedding_hnsw_idx` (migration `0051`)                                                                                                                                                             | ✅   |
| Full-text indexes     | `issue_search_vector_idx`, `issue_comment_search_vector_idx` (migration `0035`)                                                                                                                                        | ✅   |
| ⚠️ Schema/index drift | The schema declares **one** index; **seven** exist only as hand-written migrations. Violates the repo's own convention                                                                                                 | ⚠️   |
| Hybrid retrieval      | `lib/search/hybrid.ts` — `websearch_to_tsquery('simple')` + `ts_rank_cd` + cosine `<=>`, fused with **RRF k=60**                                                                                                       | ✅   |
| Tuning                | `withEfSearch()` → `SET LOCAL hnsw.ef_search`, clamped 10–1000, default from `PGVECTOR_EF_SEARCH`                                                                                                                      | ✅   |
| Chunking              | ⛔ None. Whole-record embeddings only, with a 500-char `contentSnippet`                                                                                                                                                | ⚠️   |
| Coverage              | `EmbedContentType = 'issue' \| 'comment'`. **Documents are never embedded** — the richest knowledge in the product is invisible to RAG                                                                                 | ⚠️   |
| Ask's vector leg      | ⚠️ Marked "intentionally dormant" pending an organization-safe embedder (`STATUS.md:113–114`)                                                                                                                          | ⚠️   |
| Dormant RAG asset     | `lib/agents/research-graph.ts` — `plan → retrieve → grade_evidence → synthesize → verify_citations → human_review`. **Zero importers.** Exactly the citation guarantee Ask lacks                                       | ⚠️   |

Detail and the target design: [`AI_PGVECTOR_RAG.md`](AI_PGVECTOR_RAG.md).

---

## 6. Existing AI surfaces

| #   | Surface                       | Entry                                     | Writes?              | Approval                   | Mark                                    |
| --- | ----------------------------- | ----------------------------------------- | -------------------- | -------------------------- | --------------------------------------- |
| 1   | Project-agent bounded graph   | `POST /api/projects/[id]/agents/run`      | Yes (3 effect types) | Preview-only when required | ✅                                      |
| 2   | Ask (RAG)                     | `GET/POST /api/ask`                       | No                   | No                         | ✅                                      |
| 3   | Feature agents                | `/api/ai/feature-agent`, `feature-triage` | Yes                  | Partial                    | ✅                                      |
| 4   | Assistant features            | `/api/ai/*`, `/api/inbox/catch-me-up`     | No (browser applies) | Flags + workspace toggle   | ✅                                      |
| 5   | External coding agents        | `/api/issues/[id]/dispatch-agent`         | Yes                  | Yes                        | ✅                                      |
| 6   | MCP server (external clients) | `GET/POST /api/mcp`                       | Yes (6 of 11)        | Delegated                  | ✅                                      |
| 7   | Triage apply                  | `/api/issues/[id]/triage/apply`           | Yes                  | Confidence threshold       | ✅                                      |
| 8   | AI disclosure modal           | `components/ai/ai-disclosure-modal.tsx`   | Acknowledgement      | —                          | ⚠️ Forced gate; replace with an AI mark |
| 9   | Command-palette "Ask" tab     | `components/command/command-palette.tsx`  | No                   | **Not capability-gated**   | ⚠️ Offers AI where AI is off            |

Where AI is **absent** from the UI: admin (beyond agent ops), search results, inbox,
roadmap, initiatives, modules, versions, templates, intake, import, team page,
analytics, and mobile navigation — the only mobile route is the undiscoverable
`Cmd/Ctrl+J`.

---

## 7. Security findings that gate a write-capable AI

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                 | Severity    | Location                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| 1   | Agent policy is **opt-in and self-asserted**. `guardAgentAction` is invoked by the route only when `readAgentPolicyMarker(body.agentPolicy)` is non-null; the `actor` is caller-supplied; `VALIDTEAM_AGENT_POLICY=off` makes `resolveAgentPolicyMarker` return `null` so evaluation never runs. MCP does derive its own actor from `VALIDTEAM_AGENT_ACTOR` — the exposure is any **direct** REST caller | 🔴 Critical | `lib/agent-policy/guard.ts:72–95`, `packages/mcp-server/src/tools/agent-policy.ts:24–41` |
| 2   | Automation `assign` / `add_label` / `add_comment` / `set_priority` write `issues` with **no `organizationId` predicate**. Only `set_status` scopes (and it correctly routes through `prepareIssueStatusTransition`)                                                                                                                                                                                     | 🔴 Critical | `lib/automation/evaluator.ts:172–187, 191–227, 235–259, 262–281`                         |
| 3   | No RLS — every tenant boundary is an application `WHERE` + auth check                                                                                                                                                                                                                                                                                                                                   | 🟠 High     | `CLAUDE.md:82`                                                                           |
| 4   | `/api/saved-filters` GET returns another workspace's public filters; POST inserts into any supplied `organizationId`. No membership check                                                                                                                                                                                                                                                               | 🟠 High     | `app/api/saved-filters/route.ts:28–124`                                                  |
| 5   | `/api/search-history` POST deletes `WHERE createdAt < 30d AND pinned = false` with **no `userId` predicate** and only a session, not `requireCronAuth`                                                                                                                                                                                                                                                  | 🟠 High     | `app/api/search-history/route.ts:148–160`                                                |
| 6   | Prompt-injection scanning covers 3 of N AI ingress routes. Ask, triage, and the project-agent graph ingest untrusted text with no `evaluateInjectionRisk`                                                                                                                                                                                                                                               | 🟠 High     | `lib/ai/safety/sandbox.ts`                                                               |
| 7   | `content_embeddings` has **no tenant column**, so vector recall cannot be scoped without a join                                                                                                                                                                                                                                                                                                         | 🟠 High     | `schema/semantic-search.ts:11–47`                                                        |
| 8   | `runWithBudget` is **not** wrapped around the project-agent graph — the one durable AI path is unbudgeted                                                                                                                                                                                                                                                                                               | 🟠 High     | `app/api/projects/[id]/agents/run`                                                       |
| 9   | API keys carry **no scopes**; key lifecycle is not audited                                                                                                                                                                                                                                                                                                                                              | 🟡 Medium   | `schema/api-keys.ts`                                                                     |
| 10  | `recordAuditLog` (the sink dispatcher) has **zero production importers** — configured SIEM sinks receive nothing                                                                                                                                                                                                                                                                                        | 🟡 Medium   | `lib/audit/log.ts:15–34`                                                                 |
| 11  | `agent_providers.hmacSecret` stored plaintext per workspace                                                                                                                                                                                                                                                                                                                                             | 🟡 Medium   | `schema/agent-sessions.ts`                                                               |
| 12  | Two limiters, different backends: an in-memory `Map` on 4 auth flows, and a Redis-backed one used by `/api/ask` alone. No limiter on any other AI route                                                                                                                                                                                                                                                 | 🟡 Medium   | `lib/auth/rate-limit.ts:7,14`, `lib/server/rate-limit.ts:1–13`                           |
| 13  | MCP capability discovery answers for any syntactically valid `sk_live_` string (documented in the file's own header)                                                                                                                                                                                                                                                                                    | 🟡 Medium   | `packages/mcp-server/src/http.ts:1–14`                                                   |
| 14  | `agent_approval_requests.status` is `text`, not a `pgEnum`                                                                                                                                                                                                                                                                                                                                              | 🟢 Low      | `schema/agent-approvals.ts`                                                              |

⚠️ One earlier finding was **withdrawn on re-audit**: `/reset-counters` was
flagged as an unscoped global reset and is in fact correctly super-admin-gated,
optionally org-scoped, and audited. It is kept here as a reminder to verify
before acting on any claim in this document.

---

## 8. UX defects the AI layer must fix first

| #   | Defect                                                                                           | Mark |
| --- | ------------------------------------------------------------------------------------------------ | ---- |
| 1   | AI provenance on issues is **unreachable** — the receipt link goes nowhere                       | ⚠️   |
| 2   | AI affordances appear where AI is switched off (command-palette Ask tab is not capability-gated) | ⚠️   |
| 3   | A **model confidence score** is shown to end users                                               | ⚠️   |
| 4   | **No revert exists anywhere**                                                                    | ⚠️   |
| 5   | The disclosure modal is a **forced gate**, not informed consent                                  | ⚠️   |
| 6   | Streaming AI **cannot be cancelled**                                                             | ⚠️   |
| 7   | Raw internals leak into workspace settings                                                       | ⚠️   |
| 8   | Design-system debt in AI-adjacent UI                                                             | ⚠️   |
| 9   | Dashboard scope is undeclared                                                                    | ⚠️   |

---

## 9. Dormant assets — wire or delete

⚠️ These exist, are well-specified, and have no caller. Deciding is part of the
work: an unused table is a maintenance liability that looks like capability.

| Asset                                                                                                                            | Verdict                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `research-graph.ts` (`grade_evidence`, `verify_citations`, `human_review`)                                                       | 🔵 **Wire** into Ask — it is exactly the citation guarantee RAG lacks       |
| `content_embeddings` for documents                                                                                               | 🔵 **Extend** `EmbedContentType` to `document_page`                         |
| `llm_batch_jobs` — 6 declared workloads, zero writers                                                                            | 🔵 Use `embedding_backfill`; delete the other 5 declarations                |
| `resource-management.ts` — 6 tables incl. `smart_assignment_rules` (14 columns)                                                  | 🔵 **Wire** for assignment, or delete. Do not design a third thing          |
| `semantic_search_history`                                                                                                        | 🔵 Use for retrieval telemetry                                              |
| `lib/ai/safety/redact.ts` (PII)                                                                                                  | 🔵 **Adopt** — test-only importer today                                     |
| `lib/ai/observability/langfuse.ts`                                                                                               | 🔵 **Widen** — one caller (`draft-issue.ts`)                                |
| `lib/command/slash-commands.ts` (6 commands, no listeners)                                                                       | 🔵 Wire to a Document agent                                                 |
| `issue_security_levels`, `permission_scheme_grants`                                                                              | 🛑 **Enforce or delete.** An unenforced security control is worse than none |
| `verification_tokens`, `issue_attachments`, `template_reviews`, `template_categories`, `system_statistics`, `search_suggestions` | 🛑 **Delete**                                                               |

---

## 10. What this means for the design

| Finding                                   | Design consequence                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| No provider abstraction                   | Build one first. It gates DeepSeek _and_ every future model                                                                   |
| Admin cannot add a model                  | Fix the credential store shape, add `baseUrl`, implement the missing route                                                    |
| No tool registry                          | One registry, seeded from the 11 MCP tools that already authorize correctly                                                   |
| The project agent is a fixed graph        | Generalize it to `resolve → plan → gather → reason → propose → gate → execute → reflect`                                      |
| Approvals exist and are good              | Reuse verbatim; add the missing executors per tool                                                                            |
| RLS absent                                | Every tool must scope in SQL; RLS is defence-in-depth on the tenant track                                                     |
| `content_embeddings` has no tenant column | 🔵 Add `organization_id` before documents are embedded — retrofitting tenant filtering on a growing vector table is expensive |
| 24 dormant capabilities                   | The first job is **activation, not invention**                                                                                |

Sequenced in [`AI_IMPLEMENTATION_ROADMAP.md`](AI_IMPLEMENTATION_ROADMAP.md).

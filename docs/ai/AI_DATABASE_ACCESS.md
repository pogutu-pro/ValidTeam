# AI database access

**Status:** design. Applies to every path by which a model can cause data to be
read or written.

Spec §20's five prohibitions are non-negotiable:

> no database credentials · no arbitrary SQL by default · no bypassing
> authorization · no independent tenant selection · no direct provider access

---

## 0. The rule in one line

> **The AI reads the database the same way the application does: through
> parameterized, tenant-scoped queries that live in version control.**

⛔ A model never sees a connection string, a table name it can choose, or a
string it can inject into.

---

## 1. Three permitted paths, in order of preference

| #     | Path                                                                     | Model writes SQL?            | Use when                                                |
| ----- | ------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------- |
| **1** | **Tools** — typed functions over existing routes/services                | ⛔ Never                     | Always, for reads **and** writes                        |
| **2** | **Curated read models** — hand-written parameterized query builders      | ⛔ Never                     | Aggregations and cross-table questions with no tool yet |
| **3** | **Constrained read-only SQL** — 🔵 opt-in, allowlisted, Super Admin only | 🔵 Yes, but through a parser | Only after 1 and 2 are exhausted, and never for writes  |

| Path | Frequency                         | Rationale                                   |
| ---- | --------------------------------- | ------------------------------------------- |
| 1    | **≥ 90% of data access**          | Safe by construction; reuses authorization  |
| 2    | ~8%                               | Safe by review; no injection surface at all |
| 3    | **≤ 2%, Super Admin opt-in only** | Highest risk; the reason 1 and 2 exist      |

---

## 2. Path 1 — tools

Fully specified in [`AI_TOOL_SYSTEM.md`](AI_TOOL_SYSTEM.md). The database rule:

> **A tool does not open its own query against tables. It calls the route or the
> service function that already does.**

```ts
// correct — no SQL in the tool, authorization inherited
handler: (input, { client }) => client.patch(
  `/api/issues/${input.issueId}`, withAgentPolicy(input)
)

// forbidden — the tool reimplements business logic and can drift from the route
handler: (input) => db.update(issues).set({ ... }).where(eq(issues.id, input.issueId))
```

| Why                                                                                                | Consequence of the forbidden form                                 |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| The route holds the permission check, the tenant check, the workflow validation, and the audit row | The tool becomes a **second, unaudited, unauthorized** write path |
| Business rules live in one place                                                                   | A tool and a route can disagree about what "assign" means         |

⚠️ **Exception:** read-only analytics tools may use curated query builders
(path 2) rather than HTTP round-trips, because the aggregation is not a route
today. Those still use `sql` templates with interpolated values, never strings.

---

## 3. Path 2 — curated read models

### 3.1 The pattern already in the codebase

`lib/agents/ask.ts` is the reference implementation. Every query is a
**parameterized `sql` template with the tenant predicate written in**:

```ts
const tsquery = sql`websearch_to_tsquery('simple', ${query})`;
const filterProject = projectId ? sql`and i.project_id = ${projectId}` : sql``;

db.execute(sql`
  select i.id, i.title, ts_rank_cd(...) as rank
  from issues i
  where i.organization_id = ${organizationId}
    ${filterProject}
  order by rank desc
  limit ${limit}
`);
```

| Property                          | Verdict                                          |
| --------------------------------- | ------------------------------------------------ |
| Values interpolated by the driver | ✅ Injection-proof                               |
| Table and column names literal    | ✅ The model cannot choose them                  |
| `organization_id` in the `where`  | ✅ Tenant scoping is structural, not conditional |
| Optional project filter           | ✅ Adds `and`, never replaces the org predicate  |

⚠️ **The org predicate must never be conditional.** A bug like
`if (projectId) { ... } else { /* no org filter */ }` is a cross-tenant leak.
`filterProject` is safe precisely because it can only **add** a predicate.

### 3.2 Read-model rules

| #   | Rule                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------- |
| 1   | Every query takes `organizationId` as a **required** argument, resolved server-side from the actor   |
| 2   | Every query is `select` only. No `insert`, `update`, `delete`, `truncate`, `grant`, `copy`           |
| 3   | Every query has `limit ${n}` with a hard ceiling (default 50, max 500)                               |
| 4   | No `information_schema`, `pg_catalog`, or `pg_authid` access                                         |
| 5   | Column projections are explicit — never `select *` (prevents accidental PII leakage into the prompt) |
| 6   | 🔵 Each read model is unit-tested with a cross-tenant negative case                                  |

### 3.3 Where read models go

```ts
// apps/web/src/lib/ai/read-models/
export const openIssuesByProject = defineReadModel({
  sql: (p) => sql`select i.id, i.title, i.due_date, i.priority
                  from issues i
                  where i.organization_id = ${p.organizationId}
                    and i.project_id = ${p.projectId}
                    and i.status_category = 'in_progress'
                  limit ${p.limit}`,
  scope: 'organization',
  outputSchema: z.object({ id: z.string(), title: z.string() }),
});
```

⚠️ `defineReadModel` must **reject** any SQL whose text contains a write verb.
A runtime assertion is cheaper than trusting a reviewer.

---

## 4. Path 3 — 🔵 constrained read-only SQL

**Opt-in. Super Admin. Read-only. Last resort.**

### 4.1 Preconditions

| #   | Precondition                                                               | Status  |
| --- | -------------------------------------------------------------------------- | ------- |
| 1   | Paths 1 and 2 are implemented and in use                                   | Phase 2 |
| 2   | A **parser-based** validator exists (not a regex, not a blocklist)         | Phase 5 |
| 3   | It runs against a **read-replica** connection with a read-only transaction | Phase 5 |
| 4   | `statement_timeout` is set (5s) and `row_security = on`                    | Phase 5 |
| 5   | Super Admin has enabled it **per organization**                            | Phase 5 |
| 6   | Every statement is written to the audit log verbatim                       | Phase 5 |

### 4.2 Architecture

```text
model
  ↓  "sql": "select title from issues where ..."
🔵 SqlGuard.parse()        → AST, or reject
   ├─ exactly one statement          (no `;`-chaining)
   ├─ verb must be SELECT            (or WITH … SELECT)
   ├─ no DML/DDL/DCL anywhere in the tree
   ├─ only allowlisted relations     (issues, comments, projects, documents…)
   ├─ no functions outside allowlist (no pg_read_file, no lo_import, no dblink)
   ├─ no subquery may escape the org predicate  ← verified by AST, not by string
   └─ row limit injected by the guard
   ↓
🔵 read replica, READ ONLY transaction
   ↓
result → same redaction + outputSchema validation as any tool
```

| Rule                                                          | Reason                                                                       |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Parse to an **AST**                                           | A regex on `select` is trivially bypassed (`WITH x AS (DELETE … ) SELECT …`) |
| Verify the **org predicate in the AST**                       | The single most important check. Everything else is defence in depth         |
| Inject `LIMIT` yourself                                       | A model-authored limit is not a limit                                        |
| Strip any predicate on `users.email` unless tier ≥ 3 approval | PII                                                                          |

⚠️ **Even in this mode, a write is impossible** — the transaction is
`READ ONLY`, so Postgres rejects DML even if the parser is wrong. Parser **and**
database must both refuse. Defence in depth is not optional here.

### 4.3 Explicitly out of scope

| Never                            | Why                                          |
| -------------------------------- | -------------------------------------------- |
| Write SQL, ever                  | Approval does not make arbitrary DML safe    |
| DDL / migrations                 | —                                            |
| Cross-organization queries       | The AST check must make this unrepresentable |
| `COPY`, `\copy`, `pg_dump`       | Filesystem and exfiltration                  |
| User-defined functions           | Arbitrary code execution                     |
| Extensions not already installed | —                                            |

---

## 5. Tenant isolation

### 5.1 What exists

| Fact                                                                                     | Evidence                                                                                                                                  |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **No RLS**                                                                               | 0 of 69 migrations mention `ROW LEVEL SECURITY`                                                                                           |
| Tenancy is application-level                                                             | `CLAUDE.md:82` — _"isolation is app-level WHERE clauses (Postgres RLS is planned, not implemented — never claim RLS exists)"_             |
| `resolveApiActor` returns `{ userId, organizationId, role, projectScope, isSuperAdmin }` | The single boundary                                                                                                                       |
| ✅ Correct examples                                                                      | `POST /api/issues` filters projects by `apiActorCanAccessOrganization` and re-checks `parentId.organizationId === project.organizationId` |
| ⚠️ **Incorrect examples**                                                                | `lib/automation/evaluator.ts:172–281` — `assign`, `add_label`, `add_comment`, `set_priority` write `issues` with **no org predicate**     |

### 5.2 Rules for every AI data path

| #   | Rule                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `organizationId` comes from `resolveApiActor`. **Never** from the request body, the model, or a tool argument                        |
| 2   | The org predicate is **mandatory and unconditional** in every query                                                                  |
| 3   | Join-derived scope is acceptable (Ask's vector leg joins `projects`/`issues` for exactly this reason) but must be provably org-bound |
| 4   | Super Admin's org override must be **explicit and audited**, never implicit                                                          |
| 5   | 🔵 Every new query gets a cross-tenant negative test in CI                                                                           |
| 6   | 🔵 RLS on the tenant track is defence in depth — **not** a prerequisite, and never to be claimed until it ships                      |

⚠️ **Fix the automation evaluator before pointing a write-capable AI at it.**
A tool that wraps an unscoped write inherits the unscoped write; the AI makes it
reachable at scale. This is a Phase 0 blocker, not a Phase 2 improvement.

### 5.3 `content_embeddings` needs a tenant column

| Fact                                                                         | Consequence                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `content_embeddings` has **no `organizationId`**                             | Vector recall must join to `issues`/`projects` to scope                   |
| Ask's vector leg does exactly that (`p.organization_id = ${organizationId}`) | Works, but pays a join on every query and cannot be indexed on tenant     |
| Documents are not embedded _yet_                                             | 🟢 The best moment to add `organization_id` is **before** the table grows |

🔵 **Phase 3 migration:** add `organization_id not null`, backfill from the
joined record, add a composite index `(organization_id, content_type)` beside
the HNSW index. Retrofitting this on a large vector table under live traffic is
materially harder. Detail in [`AI_PGVECTOR_RAG.md`](AI_PGVECTOR_RAG.md) §5.

---

## 6. Transactions and atomicity

Spec §19. Full treatment in [`AI_AGENT_SYSTEM.md`](AI_AGENT_SYSTEM.md) §7. The
database rules:

| Rule                                            | Detail                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| One tool call = one transaction                 | Never let the model compose a multi-record commit                                              |
| Composite tools get **one** effect key          | A retry cannot duplicate half an operation                                                     |
| Status transitions go through `prepare`/`apply` | The authoritative path validates the edge, the role, the project permission, and locks the row |
| Approval + effect is atomic                     | Already guaranteed at the database boundary                                                    |
| Every transaction-boundary failure is audited   | Not only successes                                                                             |
| 🔵 `agent_run_effects.payload_pre`              | The pre-image that makes "Revert" real                                                         |

⚠️ A read model must **never** open a transaction that spans multiple queries —
it holds a connection for no reason. Single statements only.

---

## 7. Prompt-injection defence at the data layer

Untrusted data reaches the prompt from issue titles, comments, and documents.
Two controls:

| Control                      | Where                         | Status                                |
| ---------------------------- | ----------------------------- | ------------------------------------- |
| Redaction before the prompt  | `lib/ai/safety/redact.ts`     | ⚠️ exists, **one test-only importer** |
| Injection scoring on ingress | `lib/ai/safety/sandbox.ts`    | ⚠️ wired to **3** routes              |
| 🔵 Tool-output sanitizer     | between tool return and model | **new**                               |
| 🔵 Record-type trust labels  | content, not just source      | **new**                               |

```ts
// the boundary that does not exist yet
const safe = await sanitizeForPrompt(toolResult, {
  trust: tool.returnsRecords ? 'untrusted' : 'trusted',
  redact: ['users.email', 'api_keys.hash', 'authSecret'],
  maxChars: 8_000,
});
```

| Rule                                                                   | Reason                                                                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Record content is **always** untrusted, regardless of who wrote it     | An issue written by a compromised account is still an injection vector                         |
| Redaction happens **before** the LLM call, not after                   | Once the model has seen it, redaction is meaningless                                           |
| Truncation is explicit and reported                                    | A silently truncated record reads as complete                                                  |
| 🔵 `content` inside a tool result is never interpreted as instructions | The model is told this in the tool-routing prompt **and** the data is neutralized structurally |

---

## 8. Credential rules

| Rule                                                     | Detail                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| ⛔ No model-reachable connection string                  | The AI process holds the app's pooled `DATABASE_URL` exactly as any route does — and nothing else    |
| ⛔ No separate AI database role                          | A dedicated read-only replica role is acceptable **only** for path 3                                 |
| ⛔ No credentials in prompts, tool inputs, or logs       | `llm_call_audit` stores a **hash** of the prompt today; 🔵 keep it that way and hash tool inputs too |
| Provider keys live in `credentialEnvelopes`              | AES-256-GCM, reused verbatim ([`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md) §5.4)                       |
| 🔵 Every credential read, write, and rotation is audited | ⚠️ today it is not                                                                                   |

---

## 9. Non-negotiables

> 1. **No database credentials reach the model.**
> 2. **No arbitrary SQL by default.**
> 3. **Authorization is never bypassed** — the tool calls the authorizing route.
> 4. **The AI never selects its own tenant** — `resolveApiActor` decides.
> 5. **Every data path is tenant-scoped in SQL**, with a negative test.
> 6. **Every read and every write is audited**, including the queries.
> 7. **Path 3 is opt-in, read-only, AST-validated, replica-only, audited verbatim, and Super Admin per organization.**

Related: [`AI_TOOL_SYSTEM.md`](AI_TOOL_SYSTEM.md) ·
[`AI_SECURITY.md`](AI_SECURITY.md) ·
[`AI_PGVECTOR_RAG.md`](AI_PGVECTOR_RAG.md) ·
[`AI_PERMISSIONS.md`](AI_PERMISSIONS.md)

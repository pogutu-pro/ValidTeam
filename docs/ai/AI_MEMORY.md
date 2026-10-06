# AI memory

**Status:** design.

Spec §17 asks for four memory layers. ValidTeam has **none** of them today —
which is why the AI cannot hold a conversation, learn a preference, or remember a
project.

⚠️ The one thing that _looks_ like memory is `agent_runs.checkpoint`. It stores
a **resume cursor**, not a recollection. Resuming a run is not remembering.

---

## 0. The five questions memory must answer

| Question                                | Storage                     | Mark |
| --------------------------------------- | --------------------------- | ---- |
| What were we discussing?                | `ai_threads`, `ai_messages` | 🔵   |
| What did you learn about me?            | `ai_user_preferences`       | 🔵   |
| What does this project need me to know? | `ai_project_memory`         | 🔵   |
| What did we decide, and why?            | `ai_decisions`              | 🔵   |
| What should you never do again?         | `ai_corrections`            | 🔵   |

⛔ **None exists.** No `ai_*` table appears in the audited schema.

---

## 1. The four layers

Spec §17:

| Layer            | Scope            | Lifetime   | Example                                                         |
| ---------------- | ---------------- | ---------- | --------------------------------------------------------------- |
| **Session**      | One conversation | Hours–days | "We were triaging the Orion backlog"                            |
| **User**         | One person       | Persistent | "Sam prefers metric units and concise answers"                  |
| **Project**      | One project      | Persistent | "Release 4.2 slips because the payments integration is blocked" |
| **Organization** | One workspace    | Persistent | "We use UK date format and never use Jira terminology"          |

| Layer        | Written by            | Read by                | Risk                                                   |
| ------------ | --------------------- | ---------------------- | ------------------------------------------------------ |
| Session      | the conversation      | that conversation only | Low                                                    |
| User         | explicit user action  | that user's sessions   | Medium — a wrong preference is persistent and annoying |
| Project      | explicit confirmation | that project's agents  | Medium — a wrong project fact misleads every agent     |
| Organization | org admin             | every agent in the org | ⚠️ Highest — a wrong org fact is a systemic error      |

---

## 2. Storage

```sql
-- 🔵 all new. No existing table is repurposed.
ai_threads        (id, organization_id, user_id, project_id?, title, status, created_at, last_message_at)
ai_messages       (id, thread_id, role, content, tool_calls?, tokens_used, model, provider, created_at)
ai_user_prefs     (id, user_id, key, value jsonb, confidence, source, updated_at)
ai_project_memory (id, project_id, key, value jsonb, confidence, source, valid_until?, updated_at)
ai_org_memory     (id, organization_id, key, value jsonb, set_by_user_id, updated_at)
ai_decisions      (id, organization_id, project_id?, decision, rationale, decided_by, source_ref, created_at)
ai_corrections    (id, user_id, wrong_behavior, correction, occurrences, resolved_at?)
```

🔵 `ai_threads` is the one table that resolves a known gap: `useAiConversation`
exists with `conversationId` persistence and there is **no backing store**.

### 2.1 Tenant isolation

| Table               | Tenant column                      | Note                                            |
| ------------------- | ---------------------------------- | ----------------------------------------------- |
| `ai_threads`        | `organization_id` + `user_id`      | 🔵 a thread is private to its author by default |
| `ai_messages`       | inherits `thread_id`               | ⛔ never queryable without the parent scope     |
| `ai_user_prefs`     | `user_id`                          | Personal; not shared with the org               |
| `ai_project_memory` | `project_id`                       |                                                 |
| `ai_org_memory`     | `organization_id`                  |                                                 |
| `ai_decisions`      | `organization_id` (+ `project_id`) |                                                 |

⚠️ **Every one of these must have an `organization_id` on the query path**, even
where it is derivable. RLS does not exist ([`AI_CURRENT_STATE.md`](AI_CURRENT_STATE.md)
§2), and a memory table without a tenant predicate is the same class of defect as
the automation evaluator writes.

---

## 3. The write rule — this is the whole design

> **Memory is written from explicit human statements, or from AI proposals the
> human confirms. Never from model inference.**

```text
user says   "always use UK dates"
   ↓
AI: "I'll remember UK date format for your account. Save?"
   ↓
user confirms
   ↓
ai_user_prefs upsert, source = 'user_confirmed', confidence = 1.0
```

| Source           | Confidence | Autonomous write?                    |
| ---------------- | ---------- | ------------------------------------ |
| `user_stated`    | 1.0        | ✅ the user just said it             |
| `user_confirmed` | 1.0        | ✅ the user approved the proposal    |
| `inferred`       | 0.3–0.6    | ⛔ **never** — requires confirmation |
| `imported`       | 1.0        | 🔵 admin-only bulk import            |

| Why                                                       | Reason                                             |
| --------------------------------------------------------- | -------------------------------------------------- |
| Inference-based memory makes the AI wrong **permanently** | A user cannot correct a preference they cannot see |
| Confidence must be visible                                | 🔵 The UI shows why the AI believes something      |
| Low confidence decays                                     | 🔵 Below 0.4, propose re-confirmation or drop      |
| Every memory is **listable and deletable**                | 🔵 A hidden memory is unacceptable                 |
| Memory is **never** a shortcut around authorization       | ⛔ A remembered preference grants nothing          |

---

## 4. Retrieval

| Layer        | When read                | How                                                |
| ------------ | ------------------------ | -------------------------------------------------- |
| Session      | Every turn in a thread   | Last _N_ messages + 🔵 a summary                   |
| User         | Every run                | 🔵 Pinned preferences + 🔵 top-N by relevance      |
| Project      | Every project-scoped run | 🔵 Pinned facts + decisions in the last 90 days    |
| Organization | Every run                | 🔵 Org conventions, small and deliberately curated |

🔵 **Budget, do not dump.** Memory is injected into a token-budgeted context
alongside retrieval ([`AI_PGVECTOR_RAG.md`](AI_PGVECTOR_RAG.md) §3.3). A memory
store that grows unboundedly into every prompt is a cost and a noise problem.

| Rule                                                                                   | Reason                                                              |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 🔵 Pinned memories are always included; the rest is relevance-ranked                   | Relevance ranking without pinning means the AI forgets what matters |
| 🔵 Memory is **labelled** in the context as memory, not as retrieved content           | The model must know which is which                                  |
| ⛔ Memory never substitutes for retrieval                                              | A stale memory is worse than a fresh document                       |
| 🔵 A memory that contradicts a retrieved source is **surfaced, not resolved silently** | The user decides                                                    |

---

## 5. Thread persistence — the gap

| Fact                                            | Consequence                                             |
| ----------------------------------------------- | ------------------------------------------------------- |
| `useAiConversation` persists `conversationId`   | The client already expects continuity                   |
| 🔵 No `ai_threads` / `ai_messages` table exists | The id refers to nothing                                |
| ⚠️ So every AI surface starts cold              | Ask, assistant, and agents cannot reference prior turns |

🔵 **Phase 3 minimum viable:** `ai_threads` + `ai_messages`, a conversation
sidebar, and thread-scoped Ask. 🔵 Then: summarization for long threads, thread
titles, and project/org scoping.

| Requirement                                               | Detail                                                                                                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thread listing is **user-scoped**                         | A user sees only their own threads; 🔵 org admins see counts, not content                                                                                 |
| Deletion                                                  | 🔵 a user can delete a thread and its messages; the org cannot                                                                                            |
| Retention                                                 | 🔵 90 days default, configurable; `ai_messages` content is PII-adjacent                                                                                   |
| Export                                                    | 🔵 GDPR-style export of a user's threads                                                                                                                  |
| 🔵 Prompt content in `ai_messages` is stored **in clear** | ⚠️ This is unlike `llm_call_audit`, which stores hashes only. It is a deliberate, documented divergence — conversations must be reproducible to be useful |

⚠️ **This divergence must be a conscious decision.** The hash-only rule for
`llm_call_audit` exists so audit does not become a data store. Storing
conversation content re-introduces that risk deliberately, scoped to the thread's
owner. Document it, encrypt it at rest if the platform allows, and never copy
message content into audit rows.

---

## 6. What memory must never be

| #   | Prohibition                                        | Reason                                             |
| --- | -------------------------------------------------- | -------------------------------------------------- |
| 1   | ⛔ Never a substitute for authorization            | Memory of a past permission is not a permission    |
| 2   | ⛔ Never cross-tenant                              | 🔵 every query tenant-scoped                       |
| 3   | ⛔ Never cross-user by default                     | Sam's preferences are not Alex's                   |
| 4   | ⛔ Never store secrets, keys, or credentials       | 🔵 redact on write                                 |
| 5   | ⛔ Never store inferred facts without confirmation | §3                                                 |
| 6   | ⛔ Never unbounded                                 | 🔵 TTL + budget                                    |
| 7   | ⛔ Never hidden                                    | 🔵 listable, deletable, inspectable                |
| 8   | ⛔ Never used to justify skipping a check          | "The user usually wants this" is not authorization |
| 9   | ⛔ Never treated as ground truth over a source     | §4                                                 |

---

## 7. Forgetting

Memory without forgetting is a liability.

| Trigger                   | Action                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------- |
| TTL expiry                | 🔵 drop or archive                                                                 |
| Confidence decay          | 🔵 below 0.4 → re-confirm or drop                                                  |
| Contradiction             | 🔵 surface both; the human resolves; the loser is deleted                          |
| Project archived          | 🔵 project memory retained but not injected                                        |
| User deleted              | 🔵 cascade threads and preferences                                                 |
| Org deleted               | 🔵 cascade everything; vectors too ([`AI_PGVECTOR_RAG.md`](AI_PGVECTOR_RAG.md) §4) |
| 🔵 Memory budget exceeded | 🔵 drop lowest-confidence, report the drop                                         |

---

## 8. Implementation

| Phase  | Work                                                                          |
| ------ | ----------------------------------------------------------------------------- |
| **2**  | 🔵 `ai_user_prefs` + 🔵 `/api/me/ai-preferences` — the smallest useful slice  |
| **3**  | 🔵 `ai_threads` + `ai_messages` + conversation UI (Ask already expects it)    |
| **3**  | 🔵 `ai_project_memory`, `ai_org_memory`, `ai_decisions`                       |
| **4**  | 🔵 `ai_corrections` — 🔵 wired to the Revert button: a revert is a correction |
| **5**  | 🔵 memory retrieval into the context engine, token-budgeted                   |
| **6**  | 🔵 confidence decay, TTL enforcement, memory budget                           |
| **7+** | 🔵 team-visible project memory; 🔵 org onboarding memory import               |

⚠️ **Memory after Autopilot, not before.** A goal that runs weekly needs stable
memory; a chat that cannot remember the last message does not need a
preference store. Build the thread first — it is the visible gap.

Related: [`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md) ·
[`AI_AGENT_SYSTEM.md`](AI_AGENT_SYSTEM.md) ·
[`AI_PGVECTOR_RAG.md`](AI_PGVECTOR_RAG.md) ·
[`AI_SECURITY.md`](AI_SECURITY.md) ·

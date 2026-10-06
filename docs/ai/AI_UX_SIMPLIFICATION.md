# AI UX — simplification thesis

**Status:** design. This document argues what to remove.

Verified current surfaces and their defects:
[`CURRENT_AI_CAPABILITIES.md`](CURRENT_AI_CAPABILITIES.md) §7.
Visual and tone rules: [`AI_UX.md`](AI_UX.md).

---

## 1. The problem, stated precisely

ValidTeam does not have an AI problem. It has **too many AIs, each with its own
interface, its own trust model, and its own vocabulary.**

| Surface                   | Entry point                      | Own vocabulary          | Trust signal             | Conversation | Refuses visibly?    |
| ------------------------- | -------------------------------- | ----------------------- | ------------------------ | ------------ | ------------------- |
| **Project agent**         | Project AI button → `agents/run` | Project agent           | Approval preview modal   | ❌ one shot  | ✅                  |
| **Ask**                   | `/ask` page                      | Ask                     | **None** — no disclosure | ❌ one shot  | **❌ silent error** |
| **Feature agent**         | Per-feature modal                | Feature agent           | None visible             | ❌ one shot  | ✅                  |
| **Standup Agent**         | Standup panel                    | Standup Agent           | None visible             | ❌ one shot  | ✅                  |
| **Assistant endpoints**   | In-page prefill                  | _(none — feels native)_ | None visible             | ❌ one shot  | ✅                  |
| **External coding agent** | Dispatch dialog                  | Code Agent / Repo       | Dispatch modal           | External     | —                   |
| **MCP**                   | External clients                 | 11 tool names           | External                 | External     | External            |

Consequences a user actually feels:

1. **"Which AI do I use?"** Seven answers. No user should have to answer this.
2. **Inconsistent confidence.** Ask silently swallows provider errors behind
   `externalError` → `friendlyError` → a generic message with no retry, while
   the project agent fails loudly. Same backend, different behaviour.
3. **Trust is unearned in three of them.** Only the project agent shows an
   approval preview. The assistant endpoints prefill a form — a factually
   accurate thing to do, but the user has no way to know it was AI-written.
4. **No continuity.** Ask cannot see that you just triaged three issues. The
   project agent cannot see the document you asked about. Every interaction
   starts from zero, which is why each one has to be told everything again.
5. **Wasted surfaces.** `standup-agent`, `health-digest`, `cron-risk-digest`
   exist as separate routes and separate panels. Three implementations of "tell
   me about my project".
6. **Ten confusion sources, formally catalogued.** See
   [`CURRENT_AI_CAPABILITIES.md`](CURRENT_AI_CAPABILITIES.md) §12.

---

## 2. The thesis

> **One AI. Many specialities.**

The user learns **one** thing: open the AI, ask, and approve what it proposes.
Behind that single interface, a graph routes to internal specialists whose names
the user never has to know or choose.

### What this is not

| Not this                             | Why                                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| A chatbot bolted onto the app        | The AI must act on the work, not just talk about it                                    |
| One giant general-purpose agent      | A single unbounded agent is unbounded in every dimension                               |
| Replacing specialists                | `agentLoop` → `runBoundedGraph` and its specialisations are correct and should be kept |
| A new microservice                   | The runtime already exists and is disciplined                                          |
| Merging the routes into one endpoint | 🔵 **The seven HTTP routes stay.** Frontend consolidation, not backend collapse        |
| Making the user choose a mode        | Modes are a compatibility surface, not a design                                        |

### The single rule

**The user never chooses a specialist.** They express intent. The router picks.

---

## 3. What gets merged

### 3.1 Entry points: 7 → 3 (+1)

| Now                            | Becomes                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Project AI button              | The AI surface, project-scoped                                                                             |
| `/ask`                         | The AI surface, project-scoped                                                                             |
| Per-feature agent modal        | **The AI surface**, with the feature as context                                                            |
| Standup panel                  | **The AI surface**, with "standup" as a suggested starter                                                  |
| Assistant prefill buttons      | 🔵 **Keep** — they are good UX — but re-expressed as inline suggestions in the AI surface, with an AI mark |
| External coding agent dispatch | **Keep separate.** It opens an external tool; a different mental model                                     |
| MCP                            | **Keep separate.** It is an external integration surface                                                   |

Result: **the AI**, **inline AI suggestions**, **the Code Agent** (external),
**MCP** (external).

### 3.2 Routes: unchanged

| Route                                                            | Change                                                                                                                                                      |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET/POST /api/ask`                                              | 🔵 Becomes the AI surface's backend; citation markers required; adds `threadId`                                                                             |
| `POST /api/projects/[projectId]/agents/run`                      | 🔵 Becomes the general proposal endpoint; `runWithBudget` wrapped                                                                                           |
| `GET /api/ai/standup-agent`, `health-digest`, `cron-risk-digest` | 🔵 Collapse to **one** `GET /api/ai/digest?scope=…`. The three report functions become one digest with a scope parameter. Fewer round trips, one vocabulary |
| `GET /api/ai/daily-standup`                                      | Folded into the digest                                                                                                                                      |
| `POST /api/ai/issue-assist`, `extract-ghost`                     | 🔵 Keep as specialists behind the router. `extract-ghost` is already request-scoped                                                                         |
| Feature agent routes                                             | Folded into the general proposal endpoint                                                                                                                   |
| `POST /api/cron/agent-runs`, `agent-approval-effects`            | Unchanged                                                                                                                                                   |
| `POST /api/ai/chat`                                              | Already reserved — **use it for thread persistence** ([`AI_OPERATING_SYSTEM_PLAN.md`](AI_OPERATING_SYSTEM_PLAN.md) §5)                                      |

⚠️ Removing routes is a breaking change for anything already wired. The
deprecation path: keep `/api/ai/health-digest` and `/api/ai/cron-risk-digest`
returning the digest shape for one release, then delete.

### 3.3 Capabilities: keep them, name them internally

| Capability                                                                                                          | Status     | Belongs to                 |
| ------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------- |
| `issue-triage`, `issue-classify`, `issue-duplicate-detect`, `issue-field-extract`, `issue-draft`, `issue-breakdown` | ✅ real    | Task Agent                 |
| `issue-draft-project`                                                                                               | ✅ real    | Project Agent              |
| `issue-estimate`, `task-estimate`                                                                                   | ✅ real    | Estimation Agent           |
| `ask`, `draft-doc`, `suggest-update`, `extract-ghost`                                                               | ✅ real    | Knowledge Agent            |
| `standup-agent`, `health-digest`, `cron-risk-digest`                                                                | ✅ real    | Monitoring Agent           |
| `feature-agent`, `feature-triage`                                                                                   | ✅ real    | Planning Agent             |
| `code-agent-dispatch`                                                                                               | ✅ real    | Code Agent                 |
| `execute-effect`                                                                                                    | ✅ real    | Task Agent + Project Agent |
| `search`, `analyze`                                                                                                 | ✅ real    | generic                    |
| `workflow`, `action`, `transition`                                                                                  | ✅ real    | generic                    |
| `collaborate`, `escalate`, `delegate`, `monitor`, `report`, `automate`                                              | 🔵 missing | Task / Project Agent       |
| `organize`                                                                                                          | 🔵 missing | —                          |
| `ask-question`                                                                                                      | 🔵 missing | Knowledge Agent            |

🔵 **Naming stays internal.** The UI says "suggest", not `issue-draft`.

---

## 4. What gets removed

### 4.1 UI

| Remove                                                                 | Reason                                                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `info.ai.confidence` — the visible model confidence score              | An unsourced number the model invented. Also arguably a security-relevant disclosure                         |
| `info.ai.disclosureTitle` + `disclosureRequired` + `disclosureStorage` | 🔵 Replaced by a single low-friction **AI mark** on AI-authored content. A modal nobody reads is not consent |
| Standup panel as a separate surface                                    | Folded into the AI surface                                                                                   |
| Separate health and risk digest surfaces                               | Folded into one digest                                                                                       |
| Raw approval JSON                                                      | Replaced by structured previews ([`AI_APPROVALS.md`](AI_APPROVALS.md))                                       |
| Unreachable AI provenance on issues                                    | 🔵 Fixed, not removed — the receipt links to the issue                                                       |
| Missing revert                                                         | 🔵 Added, not removed — this is the most important addition                                                  |

### 4.2 Architecture

| Remove                                                   | Reason                                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 🔵 Any assumption that a chat reply can perform actions  | Split **always** into an action → preview → approve → apply                                                 |
| 🔵 The "AI may silently fail" path                       | Every refusal and every failure is visible and retryable                                                    |
| The idea that user-facing features need provider configs | Remove the `ai/feature-config` surface. 🔵 A product feature is not gated on an LLM; an internal feature is |

### 4.3 Never introduced

| Anti-pattern                                          | Why it is banned                      |
| ----------------------------------------------------- | ------------------------------------- |
| A second chat surface                                 | One AI, one place                     |
| "AI mode" toggles the user must configure             | Configuration belongs to admins, once |
| A visible specialist picker                           | Breaks the thesis                     |
| Chat that writes without approval                     | Breaks the trust model                |
| Streaming tokens for a proposal the user must approve | Approval needs the final artifact     |
| A separate "AI history" page                          | The audit log is the history          |
| Memory the user cannot see or edit                    | Not memory, a hidden database         |

---

## 5. The simplified flow

```text
user: "prep the release"

  ├─ ambiguity?  "which release?"
  │    └─ ask ONE clarifying question. Not five.
  │
  ├─ gather        read-only tools, parallel where safe
  │                → 6 issues in Ready for QA
  │                → 2 blockers: TN-401 blocked by TN-388
  │                → release checklist 8/11 complete
  │
  ├─ answer        one paragraph, then the proposal
  │
  ├─ propose       3 actions, each with:
  │                  · what changes, as a real diff
  │                  · why
  │                  · tier, and whether approval is needed
  │
  ├─ user:
  │    approve all · approve one · edit · dismiss · ask why
  │
  ├─ execute       resolve every id through the actor first
  │                → 3 receipts
  │                → 3 audit rows
  │
  └─ offer         "track this as a goal until Friday?"  (optional)
```

**Total surface area the user must learn: one input, one proposal, one approve
button, one history link.**

---

## 6. The three layers of the simplification

| Layer          | Before                                           | After                                                          |
| -------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| **Vocabulary** | 7 agent names, 5 readiness tiers, 3 modes        | "the AI" + "approve"                                           |
| **Trust**      | Trust is earned in 1 of 7 places, invisible in 4 | Trust is earned in **one** place, always: the proposal preview |
| **Continuity** | Each surface is stateless                        | One thread, one project context, one memory                    |

Everything else is internal implementation. That is the entire thesis: **the
complexity stays where it can be tested, and the user sees one thing.**

---

## 7. Migration path

Sequenced so nothing breaks. Detail in
[`AI_IMPLEMENTATION_ROADMAP.md`](AI_IMPLEMENTATION_ROADMAP.md).

| Stage  | Change                                                                                                                  | User-visible               |
| ------ | ----------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **0**  | Trust surface: structured previews, receipts, revert, kill switch                                                       | Approvals stop being scary |
| **1**  | The AI surface over the existing routes; specialists hidden behind the router; Ask and the project agent merge into one | One place to go            |
| **2**  | Threads; digest routes collapse                                                                                         | Conversations persist      |
| **3**  | Remove the disclosure modal and `info.ai.confidence`; add inline AI marks                                               | Less nagging, more honesty |
| **4**  | Standup/health/risk panels removed as separate surfaces                                                                 | Fewer dashboards           |
| **5+** | Goals, Autopilot, autonomous workflows                                                                                  | New capability             |

⚠️ **Stage 0 is the prerequisite.** Consolidating surfaces before the trust
surface is trustworthy would multiply a weak trust model across every surface.
Fix trust first, then unify the interface.

---

## 8. What simplification must not cost

| Must not be lost                                |
| ----------------------------------------------- |
| The preview. The single most important element. |
| The receipt and the audit trail                 |
| The refusal being visible                       |
| Citations for every factual claim               |
| Revert                                          |
| The kill switch                                 |
| The specialist quality — hidden, not deleted    |

The reduction is in **chrome**, not in **substance**. A tool that shows one
input and one button, and takes ten seconds to explain what it will do, is better
than a fast surface that does the same thing opaquely.

Related: [`AI_UX.md`](AI_UX.md) ·
[`AI_OPERATING_SYSTEM_PLAN.md`](AI_OPERATING_SYSTEM_PLAN.md) ·
[`AI_APPROVALS.md`](AI_APPROVALS.md)

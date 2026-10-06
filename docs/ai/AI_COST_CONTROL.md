# AI cost control

**Status:** design, built on verified existing machinery.

Spec §34 requires visibility, limits, and graceful failure. ValidTeam already
has a transactional budget guard with a kill switch — **better than most
products**. The gaps are narrow and specific.

---

## 0. What exists

`apps/web/src/lib/ai/budget.ts` + `packages/db/src/schema/ai-cost-guard.ts`.

| Component            | Reality                                                                                                                                                                                            | Mark |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Reservation          | `checkAndReserveTokens(orgId, estimatedTokens, model)` — **pre-reserves** an estimate inside `db.transaction` with `SELECT … FOR UPDATE` on the org row, so two parallel calls cannot double-spend | ✅   |
| Commit               | `commitUsage(...)` — appends the `llm_call_audit` row and trues the counters up to the provider's actual numbers                                                                                   | ✅   |
| Refund               | `refundReservation(...)` — returns the unused reservation                                                                                                                                          | ✅   |
| Wrapper              | `runWithBudget(orgId, userId, params, callable)`                                                                                                                                                   | ✅   |
| Limits               | `dailyTokenLimit`, `monthlyTokenLimit`, `dailyCostUsdLimit`, `monthlyCostUsdLimit` — **null = unlimited**                                                                                          | ✅   |
| Counters             | `dailyUsedTokens`, `monthlyUsedTokens`, `dailyUsedCost`, `monthlyUsedCost`                                                                                                                         | ✅   |
| Period reset         | `periodResetsAt`, computed by `computeRollover`, rolled lazily on next check                                                                                                                       | ✅   |
| Kill switch          | `killSwitchEnabled` → every call rejected with `budget_kill_switch`                                                                                                                                | ✅   |
| Immutability         | Migration installs UPDATE/DELETE triggers on `llm_call_audit`                                                                                                                                      | ✅   |
| Audit row            | `llm_call_audit` — **prompt hash only, never the prompt**                                                                                                                                          | ✅   |
| Pricing              | `estimateCostUsd(model, in, out)` — a prefix-matched table that **biases generously**                                                                                                              | ✅   |
| Per-feature counters | `llm_usage_stats`                                                                                                                                                                                  | ✅   |
| Admin analytics      | `/api/admin/ai-usage`; 🔵 scoped reset exists and is correctly gated                                                                                                                               | ✅   |

⚠️ This is genuinely good infrastructure. The problems below are about
**coverage and accuracy**, not about the absence of control.

---

## 1. The verified gaps

| #   | Gap                                                               | Severity | Detail                                                                                                               |
| --- | ----------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | **`runWithBudget` is not wrapped around the project-agent graph** | 🔴       | The one durable, multi-step AI path is **unbudgeted**                                                                |
| 2   | The pricing table has **no DeepSeek entries**                     | 🔴       | `MODEL_PRICING` matches `/^gpt-5/i`, `/^claude-*/i` … and falls through to `FALLBACK_PRICING` = `$0.01/$0.03` per 1k |
| 3   | A **prefix-matched static table** cannot track a moving market    | 🟠       | Prices change; the table will silently over- or under-charge                                                         |
| 4   | No **per-user** budget                                            | 🟠       | One user can consume an org's entire daily limit                                                                     |
| 5   | No **per-feature** budget                                         | 🟠       | `llm_usage_stats` records it but nothing caps it                                                                     |
| 6   | 🔵 `llm_call_audit` has no `runId`                                | 🟠       | Cost cannot be attributed to a run, so "why was this expensive?" is unanswerable                                     |
| 7   | No **cache layer**                                                | 🟠       | Identical questions are re-billed in full                                                                            |
| 8   | 🔵 No **projection**                                              | 🟡       | "At this rate you will hit the limit on the 14th" requires arithmetic by hand                                        |
| 9   | ⚠️ **Langfuse has one caller**                                    | 🟡       | `draft-issue.ts` only; every other provider call is untraced                                                         |

⚠️ **Gap 2 is the immediate consequence of the DeepSeek decision.** Routing
reasoning to DeepSeek while pricing it at the OpenAI-4 fallback overstates cost
by roughly an order of magnitude — which would make the budget guard reject
affordable work. Pricing must be correct _before_ the provider switch, not after.

---

## 2. The model-role cost architecture

Spec §31 wants cost-aware routing. The cheapest correct system assigns a **role**
to each call site and prices the role.

| Role        | Purpose                    | Model class    | Tier | Share of calls   |
| ----------- | -------------------------- | -------------- | ---- | ---------------- |
| `classify`  | Intent, triage, routing    | smallest cheap | 0    | ~35%             |
| `extract`   | Entities, fields, labels   | small          | 0    | ~15%             |
| `summarize` | Condense retrieved context | small          | 0/1  | ~10%             |
| `plan`      | Multi-step orchestration   | mid            | —    | ~5%              |
| `reason`    | Hard analysis, synthesis   | largest        | —    | ~5%              |
| `generate`  | User-facing prose          | mid            | —    | ~20%             |
| `embed`     | Retrieval vectors          | embedding-only | 0    | 🔵 volume-driven |

| Rule                                                              | Reason                                                                                                                            |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| A role is bound to a **call site**, not chosen per request        | Predictability                                                                                                                    |
| The **largest** model is used for the **smallest** share of calls | Most spend is extraction, not reasoning                                                                                           |
| `embed` is a separate concern                                     | DeepSeek has no comparable embedding API; embeddings stay on a dedicated provider ([`AI_PGVECTOR_RAG.md`](AI_PGVECTOR_RAG.md) §8) |
| 🔵 Each role has a **token ceiling**                              | A runaway summarizer is stopped, not billed                                                                                       |
| 🔵 Role → model is org-configurable                               | Different customers want different tradeoffs                                                                                      |

⚠️ **Roughly 40% of all calls are `classify` or `extract`.** Routing those to a
frontier model is the single largest cost mistake available in this design, and
the easiest to avoid.

---

## 3. The budget stack

```text
platform ceiling            Super Admin: absolute daily/monthly USD
  └─ org budget            ✅ exists — daily/monthly tokens + USD
       ├─ feature budget   🔵 llm_usage_stats exists; add a cap
       ├─ user budget      🔵 new
       └─ run budget       🔵 new — per agent run
            └─ call ceiling 🔵 per role, per call
```

| Layer    | Enforced by                | Behavior at the limit                                              |
| -------- | -------------------------- | ------------------------------------------------------------------ |
| Platform | 🔵 global config           | All AI stops; super admin notified                                 |
| Org      | ✅ `checkAndReserveTokens` | 🔵 `budget_exhausted`, **loudly**                                  |
| Feature  | 🔵 new                     | 🔵 That feature degrades to disabled, visibly                      |
| User     | 🔵 new                     | 🔵 That user is refused, with a clear message                      |
| Run      | 🔵 new                     | 🔵 The run terminates `budget_exhausted`; partial effects reported |
| Call     | 🔵 new                     | 🔵 The call is refused before dispatch                             |

### 3.1 The non-negotiable behaviour

> **Exhaustion is a loud, typed failure — never a silent downgrade to a weaker
> model.**

```text
✗  "I'll answer using a smaller model to stay under budget."

✓  "I've reached this workspace's token budget for today.
    Your budget resets at 00:00 UTC, or an admin can raise it.
    I've saved the run — nothing was changed."
```

| Why                                                     | Reason                                            |
| ------------------------------------------------------- | ------------------------------------------------- |
| A silent downgrade produces **unknown-quality output**  | The user cannot tell they got a worse answer      |
| The failure is **rare and important**                   | It deserves a real message, not a fallback        |
| 🔵 A partially executed run must be reported as partial | Silent partial success is worse than a clean stop |

⚠️ A **deliberate, user-visible** downgrade is acceptable when the user asks for
it ("answer this quickly and cheaply"). An _automatic, invisible_ one is not.

### 3.2 Reservation discipline

The existing pre-reserve/commit/refund cycle is correct. Extending it:

| Rule                                                   | Reason                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Reserve **before** dispatch                            | Fail fast, not after paying                                                   |
| Commit the provider's **actual** usage                 | The estimate is deliberately generous                                         |
| Refund on failure                                      | A crashed call costs tokens but should not cost budget                        |
| 🔵 Reserve per **run**, not only per call              | A 40-step run must not be able to exceed its ceiling by 40 small reservations |
| 🔵 A run reservation is **released** on terminal state | Leases and reservations must not leak                                         |

⚠️ The current `SELECT … FOR UPDATE` serialization is per **organization**. That
is correct and it does not need to change — but it does mean reservation is a
contention point at very high org volume. Not a Phase-1 concern.

---

## 4. Accurate pricing

⚠️ `estimateCostUsd` matches a hardcoded prefix table. For a provider-agnostic
system this must become configuration.

```ts
// 🔵 org-configurable, platform-defaulted
interface ModelPricing {
  provider: string;
  model: string;
  inputPer1k: number;
  outputPer1k: number;
  cachedInputPer1k?: number;
  effectiveFrom: Date;
}
```

| Requirement                                                        | Reason                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Pricing is **data**, not code                                      | 🔵 a new model must not require a deploy                                             |
| 🔵 Keyed by `(provider, model)`, never by prefix alone             | Prefix matching misprices `gpt-4o` vs `gpt-4o-mini` vs a custom deployment           |
| 🔵 `effectiveFrom` allows a price change without rewriting history | Otherwise historical rows silently change meaning                                    |
| 🔵 Seeded with **DeepSeek** rates before the provider switch       | Otherwise the fallback overstates cost ~10×                                          |
| 🔵 `cachedInputPer1k` for prompt caching                           | Cached tokens are 10–100× cheaper and must not be billed as input                    |
| The bias stays **generous**                                        | The current comment is right: overestimate for safety, reconcile against the invoice |

⚠️ **The provider's invoice is the source of truth.** `estimateCostUsd` is an
internal estimate for enforcement. 🔵 A monthly reconciliation job should
compare the two and alert on divergence — otherwise the budget guard and the
bill silently disagree.

---

## 5. Cache and reuse

| #   | Lever                                                                  | Saving                                           | Mark                    |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------ | ----------------------- |
| 1   | **Response cache** keyed on `(model, promptHash, params)`              | Large on repeated questions                      | 🔵                      |
| 2   | **Embedding cache** — `contentHash` already exists                     | Large on re-index                                | ✅ partly               |
| 3   | **Prompt prefix caching** — system prompts and tool schemas are stable | Large with provider support                      | 🔵 + `cachedInputPer1k` |
| 4   | **Retrieval cache** keyed on `(question, org, project, corpusVersion)` | Latency **and** tokens                           | 🔵                      |
| 5   | 🔵 **Deduplicate identical concurrent calls**                          | Avoids a thundering herd on one popular question | 🔵                      |

| Rule                                                 | Reason                                             |
| ---------------------------------------------------- | -------------------------------------------------- |
| Cache keys include the **model and the prompt hash** | Never serve a cached answer from a different model |
| 🔵 Cache invalidates on `corpusVersion` bump         | Otherwise a stale answer outlives its sources      |
| ⛔ **Never cache a tool call with side effects**     | Tier 2+ results are receipts, not cache entries    |
| ⛔ Never cache across tenants                        | The key is org-scoped                              |
| Report the cache hit rate                            | It is the clearest cost metric available           |

⚠️ `llm_call_audit` already has a `cachedTokens` column ✅ — the schema anticipated
this. It is simply never populated.

---

## 6. Visibility

Spec §33. 🔵 The dashboards defined in [`AI_AUDIT.md`](AI_AUDIT.md) §9.2, plus:

| Metric                          | Why                                             |
| ------------------------------- | ----------------------------------------------- |
| Spend by **provider**           | The DeepSeek switch should show a visible delta |
| Spend by **role**               | Proves the routing is doing what §2 claims      |
| Spend by **feature**            | Which surface is expensive                      |
| Spend by **user**               | Fairness and abuse detection                    |
| Cost per **run**                | Which agents are expensive                      |
| Cost per **answered question**  | The efficiency metric that matters              |
| 🔵 **Projected month-end**      | "You will exceed on the 14th"                   |
| 🔵 **Cache hit rate**           | The biggest lever, made visible                 |
| 🔵 **Rejected-by-budget count** | Silent demand being turned away                 |

| Requirement                                         | Detail                               |
| --------------------------------------------------- | ------------------------------------ |
| A user sees **their own** spend                     | Cost transparency is a trust feature |
| An org admin sees **the org's** spend               | 🔵 existing `/api/admin/ai-usage`    |
| 🔵 The budget state is visible **before** it is hit | Not after                            |
| 🔵 Reset is admin-only, org-scoped, and audited     | ✅ already correct — preserve it     |

---

## 7. Alerts

| Trigger                                               | Action                                              |
| ----------------------------------------------------- | --------------------------------------------------- |
| 50% / 80% of any limit                                | 🔵 notify the user; notify the org admin at 80%     |
| 🔵 Projected overrun                                  | 🔵 notify the org admin with the projected date     |
| Budget exhausted                                      | Notify; 🔵 **fail loudly**, never degrade           |
| 🔵 Kill switch engaged                                | Log actor + reason; notify super admins immediately |
| 🔵 Spend anomaly (> 3× the 7-day median for the hour) | 🔵 alert — runaway loop or abuse                    |
| 🔵 Cost per question doubles week-over-week           | 🔵 warn — usually a retrieval or prompt regression  |
| 🔵 Price-table divergence from the invoice > 10%      | 🔵 warn — the pricing data is stale                 |
| Cache hit rate collapses                              | 🔵 warn — usually a cache-key change                |

---

## 8. Implementation

| Phase | Work                                                                   |
| ----- | ---------------------------------------------------------------------- |
| **0** | 🔴 Wrap `runWithBudget` around the project-agent graph                 |
| **0** | 🔴 Add DeepSeek rows to `MODEL_PRICING` **before** the provider switch |
| **1** | 🔵 `ModelPricing` as data; `(provider, model)` keyed; `effectiveFrom`  |
| **1** | 🔵 `runId` on `llm_call_audit` so cost attributes to a run             |
| **2** | 🔵 Response + retrieval cache; populate `cachedTokens`                 |
| **3** | 🔵 Prompt prefix caching where the provider supports it                |
| **6** | 🔵 Per-user, per-feature, per-run budgets                              |
| **6** | 🔵 Projection, anomaly alerts, invoice reconciliation                  |

Related: [`AI_MODEL_STRATEGY.md`](AI_MODEL_STRATEGY.md) ·
[`AI_AUDIT.md`](AI_AUDIT.md) ·
[`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md) ·
[`AI_PERMISSIONS.md`](AI_PERMISSIONS.md)

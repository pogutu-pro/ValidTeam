# AI pgvector and RAG

**Status:** design.

pgvector is ValidTeam's strongest existing AI asset: indexed, tuned, and already
answering `/api/ask`. Spec §21 and §23 are largely about **finishing and securing
what exists**, not building something new.

Evidence: [`AI_CURRENT_STATE.md`](AI_CURRENT_STATE.md) §5.

---

## 1. What exists, precisely

| Element             | Reality                                                                                                                                                                                                                | Mark |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Extension           | `vector` column type, `vector(1536)`                                                                                                                                                                                   | ✅   |
| Table               | `content_embeddings` — `contentType`, `contentId`, `issueId`, `commentId`, `projectId`, `contentSnippet`, `metadata`, `embedding`, `embeddingModel`, `embeddingProvider`, `tokensUsed`, `contentHash` (MD5), `version` | ✅   |
| ⚠️ Tenant column    | ⛔ **None**                                                                                                                                                                                                            | ⚠️   |
| HNSW index          | `content_embeddings_embedding_hnsw_idx` (migration `0051`)                                                                                                                                                             | ✅   |
| Full-text indexes   | `issue_search_vector_idx`, `issue_comment_search_vector_idx` (migration `0035`)                                                                                                                                        | ✅   |
| ⚠️ Schema drift     | The schema declares **one** index; **seven** exist only as hand-written migrations — violates the repo's own convention (`packages/db/CLAUDE.md`)                                                                      | ⚠️   |
| Model               | `text-embedding-3-small` in the pipeline; ⚠️ the column **defaults to `text-embedding-ada-002`**, misdescribing real rows                                                                                              | ⚠️   |
| Queue               | `content_embeddings_queue` — `bigserial`, `status` (`pending`/`running`/`done`/`failed`), `attempts`, `lastError`; DB triggers on issue/comment writes + `pg_notify('content_embeddings_jobs')`                        | ✅   |
| Worker              | `/api/cron/embeddings` — MD5 change detection, `LISTEN` + polling fallback, batch + concurrency                                                                                                                        | ✅   |
| Retrieval           | `lib/agents/ask.ts` — `retrieveIssuesBm25`, `retrieveDocsBm25`, `retrieveVectorContent`                                                                                                                                | ✅   |
| Hybrid              | `lib/search/hybrid.ts` — `websearch_to_tsquery('simple')` + `ts_rank_cd`, cosine `<=>`, fused with **RRF k=60**                                                                                                        | ✅   |
| Tuning              | `withEfSearch()` → `SET LOCAL hnsw.ef_search`, clamped 10–1000, `PGVECTOR_EF_SEARCH`                                                                                                                                   | ✅   |
| ⚠️ Coverage         | `EmbedContentType = 'issue' \| 'comment'`. **Documents are never embedded**                                                                                                                                            | ⚠️   |
| ⚠️ Ask's vector leg | "intentionally dormant" pending an organization-safe embedder (`STATUS.md:113–114`)                                                                                                                                    | ⚠️   |
| ⚠️ Chunking         | ⛔ None. Whole-record embeddings with a 500-char snippet                                                                                                                                                               | ⚠️   |
| 🔵 Dormant asset    | `lib/agents/research-graph.ts` — `grade_evidence`, `verify_citations`, `human_review`. **Zero importers**                                                                                                              | ⚠️   |

---

## 2. What the user asked for

Spec §21 lists eight requirements. Status against reality:

| #   | Requirement                                                          | Status                                    | Work                                          |
| --- | -------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------- |
| 1   | pgvector storage                                                     | ✅ **Done**                               | —                                             |
| 2   | Organization/project/permission-aware retrieval                      | ⚠️ **Join-scoped, no index**              | 🔵 add `organization_id`, composite index     |
| 3   | Embeddings for issues, comments, documents, wiki pages, sprint notes | ⚠️ 2 of 5                                 | 🔵 extend `EmbedContentType`, backfill        |
| 4   | Hybrid keyword + vector search                                       | ✅ **Done** — RRF k=60                    | 🔵 fix schema/index drift                     |
| 5   | Context assembly                                                     | ⚠️ Ask assembles                          | 🔵 extract as a reusable `ContextEngine`      |
| 6   | Citations with source records                                        | ⚠️ Sources streamed; not verified         | 🔵 wire `research-graph.ts`                   |
| 7   | Retrieval evaluation                                                 | ⛔                                        | 🔵 `semantic_search_history` is dead — use it |
| 8   | Cost/token tracking                                                  | ✅ `tokensUsed` per row; `llm_call_audit` | 🔵 surface per-question cost                  |

**So: 2 of 8 complete, 3 partial, 3 missing.** No rewrite required.

---

## 3. The three-stage retrieval design

```text
user question
   ↓
1. CONTEXT      who is asking, what org/project, what may they see
   ↓
2. RETRIEVAL    hybrid fan-out over four corpora, fused by RRF
   ↓
3. ASSEMBLY     dedupe → re-rank → token-budgeted pack → citations
   ↓
              model (grounded, no free recall)
```

### 3.1 Stage 1 — context

| Input                                              | Source                           | Note                                             |
| -------------------------------------------------- | -------------------------------- | ------------------------------------------------ |
| `userId`, `organizationId`, `role`, `projectScope` | `resolveApiActor`                | Server-derived; never from the prompt            |
| Recent threads / focus                             | 🔵 `ai_threads`                  | [`AI_MEMORY.md`](AI_MEMORY.md)                   |
| Permissions                                        | `resolveProjectCapabilityAccess` | Determines which projects are retrievable at all |

⛔ **A question about a project the actor cannot read must not retrieve a single
row from it.** Filtering happens _before_ retrieval, not after.

### 3.2 Stage 2 — four-corpus fan-out

| Corpus           | Method                                            | Mark                        |
| ---------------- | ------------------------------------------------- | --------------------------- |
| Issues           | BM25 (`ts_rank_cd`) + vector                      | ✅                          |
| Comments         | BM25 + vector                                     | ✅                          |
| Documents        | BM25 only                                         | ⚠️ 🔵 add vector in Phase 3 |
| Project metadata | structured read model (statuses, labels, members) | 🔵                          |

```ts
const results = await Promise.all([
  retrieveIssuesBm25(organizationId, projectId, query), // ✅ exists
  retrieveDocsBm25(organizationId, projectId, query), // ✅ exists
  retrieveVectorContent(organizationId, projectId, query), // ⚠️ dormant
  retrieveProjectMetadata(organizationId, projectId, query), // 🔵
]);
```

| Rule                                         | Reason                                                   |
| -------------------------------------------- | -------------------------------------------------------- |
| Every retriever takes `organizationId` first | Structural tenant scoping                                |
| BM25 and vector run **in parallel**          | Latency, and a genuine hedge when one leg is weak        |
| 🔵 Fused with the **existing RRF k=60**      | Already tuned in `hybrid.ts`; do not invent a new ranker |

⚠️ `websearch_to_tsquery('simple')` is used rather than `english`. That is
correct for a codebase — identifiers like `TN-471` and `useEffect` must not be
stemmed — but it means **no English stemming or stopwords**. Accept it
deliberately; do not "fix" it.

### 3.3 Stage 3 — assembly

| Step    | Rule                                                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------- |
| Dedupe  | Same `contentId` from multiple retrievers → one entry, merged scores                                 |
| Re-rank | 🔵 cross-encoder or LLM rerank over the top 50, keep the top 12                                      |
| Budget  | **Token-budgeted, never token-blind.** `modelContextWindow − reserve`                                |
| Pack    | Group by type, most relevant first, so truncation drops the least useful                             |
| Cite    | Every pack entry carries `{ contentType, contentId, title, snippet }`                                |
| 🔵 Log  | Append to `semantic_search_history` — the dead table is exactly the evaluation substrate §21.7 wants |

| Rule                                      | Reason                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Never fill the context window completely  | Leave room for the answer, the instructions, and tool results                                  |
| Truncation is **reported**, not silent    | A silently shortened record reads as complete                                                  |
| 🔵 Every pack entry is labelled untrusted | Retrieved content is attacker-controlled ([`AI_DATABASE_ACCESS.md`](AI_DATABASE_ACCESS.md) §7) |

---

## 4. Extending coverage

### 4.1 `EmbedContentType`

```ts
export const EMBED_CONTENT_TYPES = [
  'issue', // ✅ exists
  'comment', // ✅ exists
  'document_page', // 🔵 documents + wiki pages — the biggest gap
  'sprint_note', // 🔵
] as const;
```

⚠️ **`documents` and `document_pages` are the richest knowledge in the product
and are entirely invisible to RAG.** `documents`, `document_pages`,
`document_page_revisions`, `collab_documents`, and the `wiki_*` tables exist; the
embedding pipeline never touches them.

### 4.2 Migration order

| Step | Action                                                                         | Why this order                                                   |
| ---- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| 1    | 🔵 Add `organization_id` to `content_embeddings`, nullable, backfilled by join | Must precede volume growth                                       |
| 2    | 🔵 Add index `(organization_id, content_type)`                                 | Makes tenant filtering index-backed instead of a join            |
| 3    | 🔵 Add `document_page` to the enum                                             | Opens the largest corpus                                         |
| 4    | 🔵 Backfill via a `llm_batch_jobs` row with workload `embedding_backfill`      | The table declares 6 workloads and **has zero writers** — use it |
| 5    | 🔵 Add triggers + `pg_notify` for `document_pages`                             | Keeps the new corpus live                                        |
| 6    | 🔵 Fix the `embeddingModel` default (`ada-002` → `3-small`)                    | Stop misdescribing rows                                          |
| 7    | 🔵 Declare all seven existing indexes in the schema                            | Removes drift; matches `packages/db/CLAUDE.md`                   |

### 4.3 Tenant column — the load-bearing detail

```sql
-- 🔵 target
alter table content_embeddings
  add column organization_id text;

update content_embeddings ce
   set organization_id = coalesce(p.organization_id, i.organization_id)
  from issues i
  left join projects p on p.id = i.project_id
 where ce.issue_id = i.id;

create index content_embeddings_org_type_idx
  on content_embeddings (organization_id, content_type);
```

| Benefit                             | Detail                                                               |
| ----------------------------------- | -------------------------------------------------------------------- |
| Tenant filter becomes an index scan | Instead of a join to `issues`/`projects` on every query              |
| Composite HNSW possible             | 🔵 `(organization_id, content_type)` + vector — a filtered ANN index |
| RLS later becomes possible          | The column RLS would need                                            |
| 🔵 Deletion audit                   | Which org's vectors to purge on org delete                           |

⚠️ **Do this before backfilling documents.** Adding a tenant column to a
multi-million-row vector table under live traffic, after the corpus has grown,
is materially harder than doing it now on a small table.

---

## 5. Chunking

⚠️ **None today.** A long issue description is embedded whole, with a 500-char
snippet stored.

| Problem                                       | Effect                                                           |
| --------------------------------------------- | ---------------------------------------------------------------- |
| Long records dilute the vector                | The embedding drifts toward the average of the whole document    |
| Retrieval returns the record, not the passage | The model must re-find the answer in a wall of text              |
| One vector per record caps precision          | Two unrelated topics in one issue cannot be retrieved separately |

🔵 **Target:** section-aware chunking, ~800 tokens with 100-token overlap,
split on markdown headings, never mid-code-block, each chunk carrying
`{ contentId, sectionPath, ordinal, heading }`.

| Rule                             | Reason                                                   |
| -------------------------------- | -------------------------------------------------------- |
| Chunk, keep the record reference | Citations must resolve to a record _and_ a section       |
| 🔵 Store the chunk ordinal       | So the model can be shown the surrounding passage        |
| Do not chunk short records       | An issue title plus two lines is already one chunk       |
| Re-embed the corpus once         | Chunking changes every vector — accept one full backfill |

⚠️ `embeddingModel` and `version` columns already exist. Use `version` to mark
the chunking epoch so old and new vectors can coexist during the backfill.

---

## 6. Citations

Spec §21.6 requires citations to source records, and spec §22 requires
"reasoning not needed, source needed."

| Level | Guarantee                      | Mechanism                                 | Mark         |
| ----- | ------------------------------ | ----------------------------------------- | ------------ |
| 0     | Sources streamed               | SSE `type: "sources"`                     | ✅           |
| 1     | Claim → source mapping         | `verify_citations` in `research-graph.ts` | ⚠️ dead code |
| 2     | Every claim carries ≥ 1 source | Research graph's verification step        | ⚠️ dead code |
| 3     | Unsupported claims are refused | Same node                                 | ⚠️ dead code |
| 4     | Citation quality is measured   | 🔵 from `semantic_search_history`         | 🔵           |

⚠️ **`lib/agents/research-graph.ts` already implements levels 1–3 and has zero
importers.** Phase 3 wires it into Ask. This is the highest value-per-line
change in the entire RAG programme: it converts Ask from "plausible prose" to
"checkable claims".

🔵 Answer envelope:

```json
{
  "answer": "…",
  "claims": [
    { "text": "…", "sources": [{ "contentType": "issue", "contentId": "…", "heading": "Rollout" }] }
  ],
  "unresolved": ["what we could not support"],
  "usage": { "tokens": 3120, "costUsd": 0.0009 }
}
```

⚠️ Ask already emits an `unresolved` frame type. The mechanism exists; it is not
surfaced well.

---

## 7. Retrieval evaluation

Spec §21.7. ⛔ Nothing measures retrieval quality today.

🔵 **Reuse the dead `semantic_search_history` table** rather than creating
another one. It exists precisely for this.

| Metric                           | Definition                                 | Why it matters                         |
| -------------------------------- | ------------------------------------------ | -------------------------------------- |
| Citation precision               | Claims whose source actually supports them | Stops confident wrong answers          |
| Retrieval recall@k               | Relevant records in the top _k_            | Detects chunking and query regressions |
| Unresolved rate                  | Claims with no supporting source           | The honesty metric                     |
| Groundedness                     | Claims entailed by their sources           | The hallucination proxy                |
| Token cost per answered question | `tokensUsed` ÷ questions                   | The efficiency metric                  |
| Latency p50/p95                  | Retrieval vs generation split              | Where to optimize                      |

| Requirement      | Detail                                                                          |
| ---------------- | ------------------------------------------------------------------------------- |
| Offline gold set | 🔵 50–100 (question, expected source) pairs per corpus, seeded from real usage  |
| Online feedback  | 🔵 thumbs up/down + "wrong source" on a citation                                |
| CI gate          | 🔵 Recall@k and citation precision must not regress below the recorded baseline |
| Privacy          | 🔵 store hashes, not question text, unless the user opted in                    |

⚠️ An evaluation set is what makes every other RAG change safe. Without one,
chunking and re-ranking are guesses.

---

## 8. Embeddings and the provider layer

| Fact                                                        | Consequence                                                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `embeddingProvider` column already exists                   | The schema anticipated provider diversity                                                                                                              |
| The pipeline hardcodes OpenAI (`text-embedding-3-small`)    | Must move behind `AIProvider.embed()`                                                                                                                  |
| 🔵 DeepSeek has **no** embedding API comparable to OpenAI's | 🟢 **Decision: embeddings stay on a dedicated provider, reasoning moves to DeepSeek.** These are separable concerns and the schema already models them |
| 1536 dimensions                                             | 🔵 Changing it invalidates the entire corpus — a full re-embed and a new column. Treat as a one-way door                                               |
| MD5 `contentHash`                                           | Change detection only; 🔵 `sha256` is the correct choice for a new pipeline but not worth a migration on its own                                       |

⚠️ **Model and dimension must be recorded per vector** — the columns exist. If
you ever mix dimensions or models in one index, retrieval silently degrades and
the cause is invisible.

---

## 9. Cost and performance

| Lever                | Current                                | Target                                                                                                                |
| -------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `hnsw.ef_search`     | Configurable 10–1000, default from env | 🔵 tune per corpus; documents need more than issues                                                                   |
| Retrieval fan-out    | 2–3 queries in parallel                | 4 with project metadata                                                                                               |
| Top-k                | Undocumented                           | 🔵 12 assembled / 50 reranked, explicit                                                                               |
| Caching              | None                                   | 🔵 🔵 per-question cache keyed on `(question, org, project, corpusVersion)` — the single biggest latency and cost win |
| `tokensUsed` per row | ✅ recorded                            | 🔵 surface per question                                                                                               |
| 🔵 Embedding cost    | Untracked per org                      | Track via `llm_call_audit`                                                                                            |

| Rule                                      | Reason                                              |
| ----------------------------------------- | --------------------------------------------------- |
| Cache invalidates on `corpusVersion` bump | Otherwise stale answers outlive their sources       |
| 🔵 Retrieval latency budget: 400ms p95    | Non-negotiable for a perceived-instant UI           |
| Never trade tenant filtering for speed    | 🔵 A `LIMIT` applied before the org predicate leaks |

---

## 10. Non-negotiables

> 1. **Tenant scope before retrieval**, never after.
> 2. **`organization_id` on `content_embeddings`** before the corpus grows.
> 3. **Every answer cites records** the user can open.
> 4. **Hybrid retrieval** — keyword _and_ vector, fused by the existing RRF.
> 5. **Token-budgeted assembly** with reported truncation.
> 6. **Retrieved content is untrusted input**, never instruction.
> 7. **Evaluated, not assumed** — a gold set before any chunking change.
> 8. **1536 is one-way.** Changing dimensions means a new column and a full re-embed.

Related: [`AI_CURRENT_STATE.md`](AI_CURRENT_STATE.md) ·
[`AI_ARCHITECTURE.md`](AI_ARCHITECTURE.md) ·
[`AI_DATABASE_ACCESS.md`](AI_DATABASE_ACCESS.md) ·
[`AI_MODEL_STRATEGY.md`](AI_MODEL_STRATEGY.md) ·
[`AI_COST_CONTROL.md`](AI_COST_CONTROL.md)

# AI tool catalogue

**Status:** design. Every endpoint below was read in the audited tree.

This is the reference list for [`AI_TOOL_SYSTEM.md`](AI_TOOL_SYSTEM.md). It
documents **what exists to be wrapped**, not a new API. A tool is a typed proxy
over a route that already authorizes correctly.

🔵 = the tool does not exist yet; the endpoint it wraps does.
✅ = the tool exists (the 11 MCP tools).

⚠️ **Generate this file from `aiTools`.** A hand-maintained catalogue of a code
registry is wrong within one release.

---

## Legend

| Mark | Meaning                        |
| ---- | ------------------------------ |
| ✅   | Exists today as an MCP tool    |
| 🔵   | Endpoint exists, tool does not |
| ⛔   | Must not be exposed as a tool  |

---

## 1. Issues and work items

| Tool                 | Method + path                                       | Tier  | Gate                                                                                    | Mark |
| -------------------- | --------------------------------------------------- | ----- | --------------------------------------------------------------------------------------- | ---- |
| `search_issues`      | `POST /api/search/hybrid`                           | 0     | `resolveApiActor` + `canReadProject`                                                    | ✅   |
| `get_issue`          | `GET /api/issues/[issueId]`                         | 0     | `resolveApiActor` + `canReadProject`                                                    | ✅   |
| `list_my_assigned`   | `GET /api/issues/my-issues`                         | 0     | `resolveApiActor`                                                                       | ✅   |
| `get_my_workload`    | `GET /api/users/me/standup/today`                   | 0     | `resolveApiActor`                                                                       | ✅   |
| `list_projects`      | `GET /api/projects`                                 | 0     | `resolveOrganizationAccess`                                                             | ✅   |
| `create_issue`       | `POST /api/issues`                                  | 2     | `checkIssuePermission(userId, projectId, 'create')` → `canCreateIssues`                 | ✅   |
| `update_issue`       | `PATCH /api/issues/[issueId]`                       | 2     | `'edit'` → `canEditIssues`                                                              | ✅   |
| `assign_issue`       | `PATCH /api/issues/[issueId]`                       | 2     | 🔵 `issue:assign` + `canAssignIssues`                                                   | ✅   |
| `create_subtask`     | `POST /api/issues` (`parentId`)                     | 2     | as `create_issue` + parent must be same project **and** same organization               | ✅   |
| `transition_status`  | `POST /api/issues/[issueId]/triage` 🔵 / `PATCH`    | 2     | `prepareIssueStatusTransition` — role + project capability + edge validation + row lock | ✅   |
| `add_comment`        | `POST /api/issues/[issueId]/comments`               | 1     | `resolveApiActor` + `canAddComments`                                                    | ✅   |
| `update_comment`     | `PATCH /api/issues/[issueId]/comments/[commentId]`  | 2     | author or `issue:edit`                                                                  | 🔵   |
| `delete_comment`     | `DELETE /api/issues/[issueId]/comments/[commentId]` | 4     | author + owner/admin                                                                    | 🔵   |
| `bulk_update_issues` | `POST /api/issues/bulk`                             | 2     | inherits the **max** tier of its members                                                | 🔵   |
| `estimate_issue`     | `POST /api/issues/[issueId]/ai-estimate`            | 1     | read + project access                                                                   | 🔵   |
| `triage_issue`       | `GET /api/issues/[issueId]/triage`                  | 0     | `resolveApiActor`                                                                       | 🔵   |
| `apply_triage`       | `POST /api/issues/[issueId]/triage/apply`           | 2     | 🔵 confidence threshold + approval                                                      | 🔵   |
| `get_issue_activity` | `GET /api/issues/[issueId]/activities`              | 0     | `resolveApiActor`                                                                       | 🔵   |
| `link_issues`        | `POST /api/issues/[issueId]/links`                  | 2     | `canLinkIssues`                                                                         | 🔵   |
| `delete_issue`       | `DELETE /api/issues/[issueId]`                      | **4** | `'delete'` → `canDeleteIssues`                                                          | ⛔   |

**Verified enforcement** — `POST /api/issues` (lines 240–300): resolves the
project by id _or_ key, filters by `apiActorCanAccessOrganization`, then
`checkIssuePermission(..., 'create')`, and re-checks that `parentId` belongs to
the same project **and** organization. This is the standard. A tool inherits it
by calling the route.

⚠️ `delete_issue` is tier 4 and excluded from the model catalogue. "Close" and
"cancel" are the AI-appropriate verbs; delete is a human action.

---

## 2. Projects and planning

| Tool                      | Method + path                                         | Tier | Gate                                                     | Mark |
| ------------------------- | ----------------------------------------------------- | ---- | -------------------------------------------------------- | ---- |
| `get_project`             | `GET /api/projects/[projectId]`                       | 0    | `canReadProject`                                         | 🔵   |
| `get_project_health`      | `GET /api/analytics/project-health`                   | 0    | project access                                           | 🔵   |
| `get_sprints`             | `GET /api/sprints`                                    | 0    | `resolveApiActor`                                        | 🔵   |
| `get_sprint_issues`       | `GET /api/sprints/[sprintId]/issues`                  | 0    | project access                                           | 🔵   |
| `update_sprint`           | `PATCH /api/sprints/[sprintId]`                       | 2    | 🔵 `sprint:*`                                            | 🔵   |
| `list_modules`            | `GET /api/projects/[projectId]/modules`               | 0    | project access                                           | 🔵   |
| `create_module`           | `POST /api/projects/[projectId]/modules`              | 2    | `project:edit`                                           | 🔵   |
| `get_workflow_statuses`   | `GET /api/workflows/[workflowId]/statuses`            | 0    | project access                                           | 🔵   |
| `transition_issue_status` | `POST /api/projects/[projectId]/workflow-transitions` | 2    | 🔵 `prepare`/`apply` pair — **never** a raw status write | 🔵   |
| `get_team_members`        | `GET /api/projects/[projectId]/members`               | 0    | project access                                           | 🔵   |
| `get_org_teams`           | `GET /api/organizations/[organizationId]/teams`       | 0    | `resolveOrganizationAccess`                              | 🔵   |
| `get_capacity`            | ⛔ **no endpoint** — tables exist, no API             | —    | —                                                        | 🔵   |

⚠️ **There is no capacity endpoint.** `user_capacity`, `workload_snapshots`,
`team_allocations`, `capacity_forecasts`, and `smart_assignment_rules` are
declared in `schema/resource-management.ts` with **zero readers and no route**.
The Team agent needs one built before `get_capacity` can exist.

---

## 3. Documents and knowledge

| Tool                   | Method + path                                   | Tier  | Gate                       | Mark |
| ---------------------- | ----------------------------------------------- | ----- | -------------------------- | ---- |
| `search_docs`          | `POST /api/docs/search`                         | 0     | `resolveApiActor`          | 🔵   |
| `get_doc_tree`         | `GET /api/docs/pages/[pageId]/tree`             | 0     | space access               | 🔵   |
| `get_doc_page`         | `GET /api/docs/pages/[pageId]`                  | 0     | space access               | 🔵   |
| `list_spaces`          | `GET /api/docs/spaces`                          | 0     | org access                 | 🔵   |
| `create_doc_page`      | `POST /api/docs/pages`                          | 1     | `canEdit` on the space     | 🔵   |
| `update_doc_page`      | `PUT /api/docs/pages/[pageId]`                  | 1     | author or space editor     | 🔵   |
| `append_doc_section`   | `PUT /api/docs/pages/[pageId]` (section append) | 1     | space editor               | 🔵   |
| `get_doc_revisions`    | `GET /api/docs/pages/[pageId]/revisions`        | 0     | space access               | 🔵   |
| `restore_doc_revision` | `POST /api/docs/pages/[pageId]/restore`         | **4** | space editor + 🔵 approval | ⛔   |
| `get_issue_docs`       | `GET /api/issues/[issueId]/docs`                | 0     | issue access               | 🔵   |

⚠️ **Documents are the largest unembedded corpus in the product.** No page is
in `content_embeddings`; `EmbedContentType` is `'issue' | 'comment'` only. Until
that changes, a Document agent must read through these tools and cannot use RAG.
[`AI_PGVECTOR_RAG.md`](AI_PGVECTOR_RAG.md) §4 specifies the fix.

🔵 `slash-commands.ts` defines 6 commands with **no listeners** — they are
tool-shaped work waiting for a Document agent.

---

## 4. Communication

| Tool                         | Method + path                               | Tier  | Gate                                         | Mark |
| ---------------------------- | ------------------------------------------- | ----- | -------------------------------------------- | ---- |
| `get_notifications`          | `GET /api/notifications`                    | 0     | `resolveApiActor`                            | 🔵   |
| `mark_notification_read`     | `PATCH /api/notifications/[notificationId]` | 1     | owner                                        | 🔵   |
| `send_internal_notification` | `POST /api/notifications` 🔵                | 2     | recipient in actor's org                     | 🔵   |
| `send_email`                 | `POST /api/email-templates` 🔵              | **3** | `org:settings`; 🔵 approval, **no override** | ⛔   |
| `post_slack_message`         | ⛔ no inbound route                         | **3** | 🔵 approval                                  | ⛔   |
| `update_jira_issue`          | 🔵 outbound only                            | **3** | 🔵 approval                                  | ⛔   |
| `dispatch_external_agent`    | `POST /api/issues/[issueId]/dispatch-agent` | **3** | 🔵 approval — **already implemented**        | ✅   |

| Rule                                          | Reason                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| Notification `type` enum has **no AI member** | 🔵 add one so an AI item is identifiable and filterable                           |
| Tier 3 tools are ⛔ from the catalogue        | An unattended outbound message is the highest-severity AI failure in this product |
| `dispatch_agent` already exists at tier 3     | It is the reference implementation for external actions                           |

---

## 5. Analytics

| Tool                    | Method + path                      | Tier | Mark |
| ----------------------- | ---------------------------------- | ---- | ---- |
| `get_velocity`          | `GET /api/analytics/velocity`      | 0    | 🔵   |
| `get_burndown`          | `GET /api/analytics/burndown`      | 0    | 🔵   |
| `get_cycle_time`        | `GET /api/analytics/cycle-time`    | 0    | 🔵   |
| `get_throughput`        | `GET /api/analytics/throughput`    | 0    | 🔵   |
| `get_forecast`          | `GET /api/analytics/forecast`      | 0    | 🔵   |
| `get_dora_metrics`      | `GET /api/analytics/dora`          | 0    | 🔵   |
| `get_insight`           | `GET /api/analytics/insight`       | 0    | 🔵   |
| `get_meeting_analytics` | `GET /api/meetings/[id]/analytics` | 0    | 🔵   |

All eight are **deterministic** — they compute, they do not generate. The AI's
job is the narrative and the comparison; the number comes from here, never from
a model. ⚠️ `analytics/insight` is one of the 20 hardcoded provider call sites
and will move behind `AIProvider` in Phase 1.

---

## 6. Ask and research

| Tool                   | Method + path                                   | Tier | Mark                       |
| ---------------------- | ----------------------------------------------- | ---- | -------------------------- |
| `ask`                  | `GET`/`POST /api/ask`                           | 0    | 🔵 existing — the flagship |
| `search_hybrid`        | `POST /api/search/hybrid`                       | 0    | 🔵                         |
| `get_semantic_history` | ⛔ no route (`semantic_search_history` is dead) | 0    | 🔵                         |

⚠️ Ask is read-only today and its **vector leg is marked "intentionally
dormant"** pending an organization-safe embedder (`STATUS.md:113–114`). So the
strongest existing RAG surface is running on keyword search alone.

🔵 `lib/agents/research-graph.ts` implements
`plan → retrieve → grade_evidence → synthesize → verify_citations → human_review`
with **zero importers**. That is the citation guarantee Ask lacks; Phase 3 wires
it rather than writing a new one.

---

## 7. Meetings

| Tool                      | Method + path                      | Tier | Mark |
| ------------------------- | ---------------------------------- | ---- | ---- |
| `list_meetings`           | `GET /api/meetings`                | 0    | 🔵   |
| `get_meeting`             | `GET /api/meetings/[id]`           | 0    | 🔵   |
| `get_meeting_analytics`   | `GET /api/meetings/[id]/analytics` | 0    | 🔵   |
| `extract_meeting_actions` | ⛔ no extraction endpoint          | 1    | 🔵   |

⚠️ `apps/web/src/lib/meetings/` and the meetings routes are **uncommitted local
work**, not part of the audited baseline. Treat the Meeting agent as Phase 7 and
re-verify the surface before designing against it.

---

## 8. Automations

| Tool              | Method + path | Tier | Mark |
| ----------------- | ------------- | ---- | ---- |
| `list_rules`      | ⛔ no route   | 0    | 🔵   |
| `create_rule`     | ⛔            | 2    | 🔵   |
| `update_rule`     | ⛔            | 2    | 🔵   |
| `get_run_history` | ⛔            | 0    | 🔵   |

⚠️ `automation_rules`, `automation_executions`, and the evaluator have **no
API surface at all**. Phase 5 must add routes before any tool exists — and must
fix the unscoped writes in `lib/automation/evaluator.ts:172–281` first, because a
tool that wraps an unscoped write inherits the unscoped write.

---

## 9. Organization and members

| Tool                  | Method + path                                                         | Tier  | Gate                          | Mark |
| --------------------- | --------------------------------------------------------------------- | ----- | ----------------------------- | ---- |
| `list_members`        | `GET /api/organizations/[organizationId]/members`                     | 0     | `resolveOrganizationAccess`   | 🔵   |
| `get_member_projects` | `GET /api/organizations/[organizationId]/members/[memberId]/projects` | 0     | org access                    | 🔵   |
| `list_candidates`     | `GET /api/organizations/[organizationId]/member-candidates`           | 0     | org access                    | 🔵   |
| `invite_member`       | `POST /api/organizations/[organizationId]/members`                    | **3** | `member:invite`; 🔵 approval  | ⛔   |
| `remove_member`       | `DELETE /api/organizations/[organizationId]/members/[memberId]`       | **4** | `member:remove` + 🔵 approval | ⛔   |

⚠️ `list_candidates` is a **people directory with names, emails, and avatars**,
gated only on org membership. It is the single most sensitive read tool in the
catalogue: `returnsRecords: true`, 🔵 PII redaction required, 🔵 excluded from
Autopilot at every tier.

---

## 10. Administration — ⛔ never a tool

Spec §35 requires the AI to explain configuration, not perform it.

| Capability           | Route                                                             | Why not a tool                |
| -------------------- | ----------------------------------------------------------------- | ----------------------------- |
| Org AI settings      | `GET`/`PATCH /api/organizations/[organizationId]/ai-agents`       | Human session, `org:settings` |
| Model configs        | `GET`/`POST /api/organizations/[organizationId]/ai-model-configs` | Key material                  |
| Platform credentials | `POST /api/admin/agent-control/credentials` 🔵 **missing**        | Super admin only              |
| Kill switch          | agent settings                                                    | Never model-reachable         |
| Tool enable/disable  | `agent_settings`                                                  | Never model-reachable         |
| Budgets              | `org_token_budgets`                                               | Never model-reachable         |

⛔ **Rationale:** a tool that can disable its own guard, raise its own budget, or
rotate its own key is not governed. The AI may _answer_ "how do I raise the
budget?" with a link; it may not do it.

---

## 11. Count

| Category            | Tier 0 | Tier 1 | Tier 2 | Tier 3/4 | Total  |
| ------------------- | ------ | ------ | ------ | -------- | ------ |
| Issues & work       | 5 ✅   | 1 ✅   | 7 ✅   | 1 ⛔     | 14     |
| Projects & planning | 8 🔵   | —      | 3 🔵   | —        | 11     |
| Documents           | 5 🔵   | 3 🔵   | —      | 1 ⛔     | 9      |
| Communication       | 1 🔵   | 1 🔵   | 1 🔵   | 4 ⛔     | 7      |
| Analytics           | 8 🔵   | —      | —      | —        | 8      |
| Ask & research      | 3 🔵   | —      | —      | —        | 3      |
| Meetings            | 3 🔵   | 1 🔵   | —      | —        | 4      |
| Automations         | 2 🔵   | —      | 2 🔵   | —        | 4      |
| Organization        | 3 🔵   | —      | —      | 2 ⛔     | 5      |
| **Total**           | **38** | **6**  | **13** | **8**    | **65** |

🔵 **11 already exist as MCP tools**; 54 to wrap; 8 permanently withheld.

| Ratio              | Target                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Read : write       | **≥ 5 : 1** — currently 38 : 19. Reads dominate **by design**, so the AI must _earn_ a write |
| Tier 0 share       | **≥ 70%** of what the model sees — currently 58%                                             |
| ⛔ share of writes | 8 of 21 write tools are withheld                                                             |

Related: [`AI_TOOL_SYSTEM.md`](AI_TOOL_SYSTEM.md) ·
[`AI_FEATURE_MATRIX.md`](AI_FEATURE_MATRIX.md) ·
[`AI_PERMISSIONS.md`](AI_PERMISSIONS.md)

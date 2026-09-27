/**
 * Side-effect imports — each module calls `registerRoute(...)` at module
 * top level. Importing this file is what populates the OpenAPI registry.
 *
 * Add new route files here.
 *
 * The registry intentionally covers the public/stable surface consumed by the
 * MCP server and other API clients. Add routes by capability rather than
 * copying a volatile count into this file.
 *
 * Outstanding categories to register next, in rough priority order:
 *   - activities, audit-logs, notifications
 *   - workflows / workflow-transitions / projects/[projectId]/workflow-transitions
 *   - automations, automation-rules
 *   - integrations (github, sentry, webhooks)
 *   - attachments, uploads
 *   - admin/*  (likely keep private)
 *   - chat / conversations / presence
 *   - templates, custom-fields, saved-filters
 *   - export, ai/*
 *   - users (broader than /me): admin/users, organizations/[id]/members
 */

import './issues';
import './projects';
import './labels';
import './versions';
import './components';
import './users';
import './search';
import './health';
import './agents';

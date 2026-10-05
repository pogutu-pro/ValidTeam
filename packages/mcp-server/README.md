# `@validteam/mcp-server`

Model Context Protocol server for ValidTeam, implemented in this monorepo.

## Current status

- Source package with stdio and HTTP scaffolding.
- Eleven issue/project-oriented tools plus resources and prompts. A pull-request
  link tool is intentionally not advertised until the web API has a matching
  persisted remote-link contract.
- Not published to npm; `npx @validteam/mcp-server` does not work yet.
- Source-built stdio calls support ValidTeam `sk_live_*` API keys across the
  current 11-tool REST surface. Keys remain bound to their organization and
  creator's current active membership and route permissions.
- HTTP OAuth 2.1/PKCE and resumable Streamable HTTP are incomplete.
- The HTTP scaffold syntax-checks `sk_live_*` Bearer values only. Capability
  discovery is not credential proof; data tools validate the key in the web
  REST actor resolver before returning data.

This package is useful for contract development and local tests. Do not present
it as a turnkey public connector until the auth, transport, publication, and
install smoke gates in `docs/ROADMAP_2026.md` are closed.

## Develop from the monorepo

```bash
pnpm install --frozen-lockfile
pnpm --filter @validteam/mcp-server build
pnpm --filter @validteam/mcp-server test
pnpm --filter @validteam/mcp-server type-check
pnpm --filter @validteam/mcp-server lint
```

Run the built stdio entry point:

```bash
VALIDTEAM_API_URL=http://localhost:3000 \
VALIDTEAM_API_KEY=sk_live_replace_me \
node packages/mcp-server/bin/validteam-mcp.mjs
```

The key format shown is syntactically representative only. Create the real key
in ValidTeam for the target organization; it is displayed once and should stay
in the MCP client's private environment.

For an MCP client during local development, point `command` to `node` and
`args` to the absolute path of
`packages/mcp-server/bin/validteam-mcp.mjs` in your checkout. Keep the URL and
key in the client's private environment/configuration, never in this repo.

## Package layout

```text
bin/validteam-mcp.mjs   stdio executable
src/server.ts            shared MCP registration
src/stdio.ts             local stdio transport
src/http.ts              HTTP transport scaffolding
src/client.ts            ValidTeam REST client
src/auth.ts              API-key / OAuth scaffolding
src/tools/                tool definitions
src/resources.ts          resources and templates
src/prompts.ts            prompt definitions
```

## Tool surface

The current source registers tools for issue create/read/update/assignment,
comments, transitions, parent-linked subtasks, search, projects, assigned work,
and workload. Treat the web REST schema as authoritative and verify it before a
tool is expanded or published.

Agent-origin metadata can be supplied through `VALIDTEAM_AGENT_ACTOR`; it does
not replace server-side authorization, approval, tenancy, audit, or idempotency.

## Publication definition of done

1. Fine-grained scoped API-key or OAuth web-route authentication works end to
   end (organization-bound API-key auth for the current tool routes is present).
2. Tool contracts match current REST validation and organization ownership.
3. Streamable HTTP/OAuth discovery and replay behavior pass protocol tests.
4. Every call records actor, scope, tool, effect, and outcome audit evidence.
5. The packed npm tarball installs and starts in clean Claude/Codex/Cursor test
   environments.
6. The package is actually published before README examples switch to `npx` or
   `pnpm add`.

See [`CLAUDE.md`](CLAUDE.md) for package-specific rules and
[`../../docs/AGENT_RUNTIME.md`](../../docs/AGENT_RUNTIME.md) for shared agent
safety/runtime requirements.

# packages/mcp-server — @validteam/mcp-server

Model Context Protocol server exposing ValidTeam to Claude/Cursor/etc. over the web app's REST API.
Root guide: `/CLAUDE.md`. Transports: stdio (`src/stdio.ts`) and HTTP (`src/http.ts`).

## Commands (run in packages/mcp-server)

```bash
pnpm build        # tsc -p tsconfig.build.json
pnpm start        # node ./bin/validteam-mcp.mjs (stdio)
pnpm test         # Jest
pnpm type-check && pnpm lint
```

## Surface

11 tools in `src/tools/`: create-issue, create-subtask, get-issue, update-issue, assign-issue,
add-comment, transition-status, search-issues, list-projects, list-my-assigned,
get-my-workload. Plus resources (`src/resources.ts`) and prompts (`src/prompts.ts`), registered in
`src/server.ts`. REST calls go through `src/client.ts`; auth resolution in `src/auth.ts`
(`VALIDTEAM_API_URL` + `VALIDTEAM_API_KEY` env).

## Current limitations (verified August 2026)

- The current 11-tool REST surface accepts ValidTeam `sk_live_*` keys. The server hashes the
  presented key, requires an active/unexpired/unrevoked record, active creator and active
  organization membership, then applies the route's existing project/issue permissions inside the
  key's immutable organization boundary.
- HTTP OAuth 2.1/PKCE verification, resumable Streamable HTTP, fine-grained key scopes, and per-call
  MCP audit evidence are still incomplete. Do not describe the HTTP scaffold as a public connector.
- HTTP capability discovery only syntax-checks the `sk_live_*` prefix. It does not prove a key is
  active; data tools are authenticated and authorized by the downstream web REST routes.
- **Not published to npm**: use the source build instructions in `README.md`;
  publication is gated on the remaining auth/transport/audit work and install smoke tests.
- Real API keys are prefixed `sk_live_`; verify every tool change against the
  authoritative route validation in `apps/web/src/app/api`.

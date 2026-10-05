/**
 * Public entry point for `@validteam/mcp-server`.
 *
 * Importers (Next.js route, tests, future remote-host wrappers) only
 * need to touch this module — the internals are reorganizable without
 * breaking consumers.
 */
export { runStdio } from './stdio.js';
export { createMcpHttpHandler, createHttpAttachedServer } from './http.js';
export { createMcpServer, SERVER_NAME, SERVER_VERSION } from './server.js';
export {
  ValidTeamClient,
  ValidTeamApiError,
  clientFromEnv,
  type ValidTeamClientOptions,
} from './client.js';
export {
  resolveStdioAuth,
  resolveHttpAuth,
  clientOptionsFromStdio,
  clientOptionsFromHttp,
  type StdioAuthContext,
  type HttpAuthContext,
} from './auth.js';
export { allTools } from './tools/index.js';
export type { ToolDefinition, AnyToolDefinition } from './tools/types.js';
export { resourceTemplates, type ResourceTemplateDefinition } from './resources.js';
export { allPrompts, type PromptDefinition } from './prompts.js';

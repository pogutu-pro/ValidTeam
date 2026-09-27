import { registerRoute, SESSION_OR_API_KEY_SECURITY, TAGS } from '../registry';
import { ErrorResponseSchema, SearchBodySchema, SearchResponseSchema } from '../schemas';

// GET /api/search
registerRoute({
  method: 'get',
  path: '/api/search',
  summary: 'Execute a JQL-style search',
  description:
    'Run a structured search query against issues. Accepts JQL-style expressions like `assignee = me AND status = "In Progress"`.',
  tags: [TAGS.Search],
  security: [...SESSION_OR_API_KEY_SECURITY],
  request: {
    query: SearchBodySchema,
  },
  responses: {
    '200': {
      description: 'Search results.',
      content: { 'application/json': { schema: SearchResponseSchema } },
    },
    '400': {
      description: 'Invalid query syntax or missing required fields.',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    '401': {
      description: 'Unauthorized.',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

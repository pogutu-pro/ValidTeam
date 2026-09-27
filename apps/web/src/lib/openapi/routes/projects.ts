import { z } from 'zod';
import { registerRoute, SESSION_OR_API_KEY_SECURITY, TAGS } from '../registry';
import { ErrorResponseSchema, ProjectListQuerySchema, ProjectSchema } from '../schemas';

// GET /api/projects
registerRoute({
  method: 'get',
  path: '/api/projects',
  summary: 'List projects accessible to the current user',
  description:
    'Returns projects from organizations the caller is a member of, optionally narrowed by `organizationId` and/or `teamId`. Browser-session super admins can see all projects in the requested scope; API keys remain confined to their organization.',
  tags: [TAGS.Projects],
  security: [...SESSION_OR_API_KEY_SECURITY],
  request: { query: ProjectListQuerySchema },
  responses: {
    '200': {
      description: 'A list of projects.',
      content: { 'application/json': { schema: z.array(ProjectSchema) } },
    },
    '401': {
      description: 'Unauthorized.',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    '403': {
      description: 'Forbidden — caller is not in the requested organization.',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

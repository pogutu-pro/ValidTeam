import { z } from 'zod';
import { registerRoute, TAGS } from '../registry';
import { ErrorResponseSchema } from '../schemas';

const startParams = z.object({
  projectId: z
    .string()
    .min(1)
    .openapi({ param: { name: 'projectId', in: 'path' } }),
});
const startHeaders = z.object({
  'Idempotency-Key': z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/)
    .openapi({ param: { name: 'Idempotency-Key', in: 'header' } }),
});

const runBody = z.object({
  kind: z.enum(['project_tracking', 'backlog_triage', 'sprint_planning', 'bulk_sprint_creation']),
  dryRun: z.boolean().optional().default(false),
});

const controlParams = z.object({
  projectId: z
    .string()
    .min(1)
    .openapi({ param: { name: 'projectId', in: 'path' } }),
  runId: z
    .string()
    .min(1)
    .openapi({ param: { name: 'runId', in: 'path' } }),
});

const controlBody = z.object({ action: z.enum(['resume', 'cancel']) });

registerRoute({
  method: 'post',
  path: '/api/projects/{projectId}/agents/run',
  summary: 'Start a durable project-agent run',
  description:
    'Starts or replays a bounded project-agent graph. Idempotency-Key is required; replaying the same request returns the original run, while reusing the key for a different request returns 409.',
  tags: [TAGS.Agents],
  request: {
    params: startParams,
    headers: startHeaders,
    body: {
      required: true,
      content: { 'application/json': { schema: runBody } },
    },
  },
  responses: {
    '200': { description: 'An existing idempotent run was returned.' },
    '202': { description: 'A new durable run was accepted and remains queued or in progress.' },
    '400': {
      description: 'Invalid body or idempotency key.',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    '409': {
      description: 'Idempotency conflict or blocked agent configuration.',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    '428': {
      description: 'Idempotency-Key header is required.',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    '429': {
      description: 'UTC daily or global concurrency quota was reached.',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

registerRoute({
  method: 'post',
  path: '/api/projects/{projectId}/agents/runs/{runId}',
  summary: 'Control a durable project-agent run',
  description:
    'Requests cancellation or requeues a resumable failed/cancelled run. Resume returns immediately; the reconciler is authoritative for eventual execution.',
  tags: [TAGS.Agents],
  request: {
    params: controlParams,
    body: {
      required: true,
      content: { 'application/json': { schema: controlBody } },
    },
  },
  responses: {
    '200': { description: 'Cancellation was requested or a terminal run was returned.' },
    '202': { description: 'The run was accepted for asynchronous resume.' },
    '400': {
      description: 'Invalid control action.',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    '403': {
      description: 'The caller cannot manage project agent runs.',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    '404': {
      description: 'No run exists in the authorized project scope.',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    '409': {
      description: 'The run state or graph version cannot be resumed.',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    '429': {
      description: 'Resume could not reserve a global active-run slot.',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

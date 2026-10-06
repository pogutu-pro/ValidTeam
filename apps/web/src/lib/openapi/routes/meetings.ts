import { z } from 'zod';
import { registerRoute, TAGS } from '../registry';

const MeetingErrorSchema = z
  .object({
    error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
  })
  .openapi('MeetingError');

const slugParam = z.object({
  id: z
    .string()
    .min(1)
    .openapi({
      param: { name: 'id', in: 'path' },
      description: 'Unguessable public meeting slug (not an internal id).',
    }),
});

const recurrence = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly']),
  interval: z.number().int().min(1).max(52).optional(),
  byWeekday: z.array(z.number().int().min(0).max(6)).optional(),
  count: z.number().int().min(1).max(366).optional(),
  until: z.string().datetime({ offset: true }).optional(),
});

const createBody = z.object({
  organizationId: z.string(),
  title: z.string().max(200),
  description: z.string().optional(),
  mode: z.enum(['instant', 'scheduled']).optional(),
  startAt: z.string().datetime({ offset: true }).optional(),
  durationMinutes: z.number().int().min(5).max(1440).optional(),
  timezone: z.string().optional().openapi({ example: 'Africa/Nairobi' }),
  participantUserIds: z.array(z.string()).optional(),
  guests: z.array(z.object({ email: z.string().email(), name: z.string().optional() })).optional(),
  recurrence: recurrence.optional(),
  access: z.enum(['invited', 'organization']).optional(),
  allowGuests: z.boolean().optional(),
});

const errors = (
  codes: Array<'400' | '401' | '403' | '404' | '409' | '410' | '425' | '429' | '503'>
) =>
  Object.fromEntries(
    codes.map((c) => [
      c,
      {
        description: `Error ${c}.`,
        content: { 'application/json': { schema: MeetingErrorSchema } },
      },
    ])
  );

registerRoute({
  method: 'get',
  path: '/api/meetings',
  summary: 'List meetings',
  description:
    'Upcoming, live or past meetings the caller hosts or is invited to (admins may pass view=all).',
  tags: [TAGS.Meetings],
  request: {
    query: z.object({
      organizationId: z.string(),
      scope: z.enum(['upcoming', 'live', 'past']).optional(),
      view: z.enum(['mine', 'all']).optional(),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
    }),
  },
  responses: { '200': { description: 'Meetings page.' }, ...errors(['400', '401', '403', '404']) },
});

registerRoute({
  method: 'post',
  path: '/api/meetings',
  summary: 'Create an instant, scheduled or recurring meeting',
  tags: [TAGS.Meetings],
  request: { body: { required: true, content: { 'application/json': { schema: createBody } } } },
  responses: {
    '201': { description: 'Meeting created.' },
    ...errors(['400', '401', '403', '404', '429']),
  },
});

registerRoute({
  method: 'get',
  path: '/api/meetings/{id}',
  summary: 'Meeting details and roster',
  tags: [TAGS.Meetings],
  request: { params: slugParam },
  responses: { '200': { description: 'Meeting.' }, ...errors(['401', '404']) },
});

registerRoute({
  method: 'patch',
  path: '/api/meetings/{id}',
  summary: 'Edit, reschedule or cancel a meeting (host or admin)',
  tags: [TAGS.Meetings],
  request: { params: slugParam },
  responses: { '200': { description: 'Updated.' }, ...errors(['400', '401', '403', '404', '409']) },
});

registerRoute({
  method: 'post',
  path: '/api/meetings/{id}/join',
  summary: 'Join as an organization member; returns a short-lived LiveKit token',
  tags: [TAGS.Meetings],
  request: { params: slugParam },
  responses: {
    '200': { description: 'LiveKit URL, token and identity.' },
    ...errors(['401', '403', '404', '410', '425', '429', '503']),
  },
});

registerRoute({
  method: 'post',
  path: '/api/meetings/{id}/guest-join',
  summary: 'Join as an external guest with an invitation token (no account)',
  tags: [TAGS.Meetings],
  request: { params: slugParam },
  responses: {
    '200': { description: 'LiveKit URL, token and identity.' },
    ...errors(['403', '410', '425', '429', '503']),
  },
});

registerRoute({
  method: 'post',
  path: '/api/meetings/{id}/end',
  summary: 'End the meeting for everyone (host or admin)',
  tags: [TAGS.Meetings],
  request: { params: slugParam },
  responses: {
    '200': { description: 'Ended (idempotent).' },
    ...errors(['401', '403', '404', '409']),
  },
});

registerRoute({
  method: 'get',
  path: '/api/meetings/{id}/participants',
  summary: 'List participants',
  tags: [TAGS.Meetings],
  request: { params: slugParam },
  responses: { '200': { description: 'Participants.' }, ...errors(['401', '404']) },
});

registerRoute({
  method: 'post',
  path: '/api/meetings/{id}/participants',
  summary: 'Invite more members or external guests (host or admin)',
  tags: [TAGS.Meetings],
  request: { params: slugParam },
  responses: { '201': { description: 'Added.' }, ...errors(['400', '401', '403', '404', '409']) },
});

registerRoute({
  method: 'delete',
  path: '/api/meetings/{id}/participants',
  summary: 'Remove a participant and disconnect them (host or admin)',
  tags: [TAGS.Meetings],
  request: { params: slugParam, query: z.object({ participantId: z.string() }) },
  responses: { '200': { description: 'Removed.' }, ...errors(['400', '401', '403', '404']) },
});

registerRoute({
  method: 'get',
  path: '/api/meetings/{id}/analytics',
  summary: 'Computed attendance statistics for a finished meeting',
  tags: [TAGS.Meetings],
  request: { params: slugParam },
  responses: {
    '200': { description: 'Stats (available=false until the meeting ends).' },
    ...errors(['401', '404']),
  },
});

registerRoute({
  method: 'get',
  path: '/api/meetings/analytics',
  summary: 'Organization (admins) or personal meeting analytics',
  tags: [TAGS.Meetings],
  request: {
    query: z.object({
      organizationId: z.string(),
      from: z.string().datetime({ offset: true }),
      to: z.string().datetime({ offset: true }),
      bucket: z.enum(['day', 'week', 'month']).optional(),
      timezone: z.string().optional(),
      scope: z.enum(['organization', 'me']).optional(),
    }),
  },
  responses: { '200': { description: 'Analytics.' }, ...errors(['400', '401', '403', '404']) },
});

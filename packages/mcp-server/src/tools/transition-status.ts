import { z } from 'zod';
import type { ToolDefinition } from './types.js';
import { withAgentPolicy } from './agent-policy.js';

export const transitionStatusInput = z.object({
  issueId: z.string().min(1),
  statusId: z
    .string()
    .min(1)
    .describe(
      'Target workflow status id. Use `get_issue` or the project resource to discover valid ids.'
    ),
});

export const transitionStatusTool: ToolDefinition<typeof transitionStatusInput> = {
  name: 'transition_status',
  description: 'Move an issue to a different workflow status.',
  inputSchema: transitionStatusInput,
  async handler(input, { client }) {
    return client.patch(
      `/api/issues/${encodeURIComponent(input.issueId)}`,
      withAgentPolicy({
        statusId: input.statusId,
      })
    );
  },
};

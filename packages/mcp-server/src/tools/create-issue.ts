import { z } from 'zod';
import type { ToolDefinition } from './types.js';
import { withAgentPolicy } from './agent-policy.js';

export const createIssueInput = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  type: z.enum(['task', 'bug', 'story', 'epic']).default('task'),
  priority: z.enum(['critical', 'high', 'medium', 'low', 'none']).default('medium'),
  assigneeId: z.string().optional(),
  labels: z.array(z.string()).optional(),
  dueDate: z.string().datetime().optional(),
});

export const createIssueTool: ToolDefinition<typeof createIssueInput> = {
  name: 'create_issue',
  description: 'Create a new issue in a ValidTeam project.',
  inputSchema: createIssueInput,
  async handler(input, { client }) {
    return client.post('/api/issues', withAgentPolicy(input));
  },
};

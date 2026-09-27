/**
 * @jest-environment node
 */

import { __internal } from '../use-workflow-builder';

describe('workflow builder transition persistence mapping', () => {
  it('restores persisted role and approval policy fields', () => {
    expect(
      __internal.transitionRowToRule({
        id: 'transition-1',
        name: 'Submit for review',
        fromStatusId: 'todo',
        toStatusId: 'done',
        allowedRoles: ['admin', 'guest'],
        requiresApproval: true,
        approverRoles: ['admin'],
        approvedTargetStatusId: 'done',
        rejectedTargetStatusId: 'todo',
        conditions: [{ field: 'assigneeId', operator: 'is_not_empty' }],
        validators: [{ type: 'required_field', field: 'description' }],
        postActions: [{ type: 'notify', target: 'assignee' }],
      })
    ).toEqual({
      id: 'transition-1',
      name: 'Submit for review',
      fromStateId: 'todo',
      toStateId: 'done',
      allowedRoles: ['admin', 'guest'],
      requiresApproval: true,
      approverRoles: ['admin'],
      approvedTargetStateId: 'done',
      rejectedTargetStateId: 'todo',
      conditions: [{ field: 'assigneeId', operator: 'is_not_empty' }],
      validators: [{ type: 'required_field', field: 'description' }],
      postActions: [{ type: 'notify', target: 'assignee' }],
    });
  });

  it('fails closed to conservative role defaults for malformed legacy JSON', () => {
    const rule = __internal.transitionRowToRule({
      id: 'transition-2',
      fromStatusId: 'todo',
      toStatusId: 'doing',
      allowedRoles: ['owner', 42],
      approverRoles: [],
    });

    expect(rule.allowedRoles).toEqual(['admin', 'member']);
    expect(rule.approverRoles).toEqual(['admin']);
    expect(rule.requiresApproval).toBe(false);
  });
});

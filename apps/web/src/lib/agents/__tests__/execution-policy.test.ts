/**
 * @jest-environment node
 */

import { resolveAgentExecutionPolicy } from '../execution-policy';

describe('project agent execution policy', () => {
  it('forces zero-write preview when write approval is required', () => {
    expect(
      resolveAgentExecutionPolicy({
        kind: 'backlog_triage',
        requestedDryRun: false,
        allowWriteActions: true,
        requireApprovalForWrites: true,
        aiOversight: 'auto',
      })
    ).toEqual({
      dryRun: true,
      forcedDryRun: true,
      writeCapable: true,
      approvalRequired: true,
      disposition: 'preview_approval_required',
    });
  });

  it('treats review_required oversight as an approval guard', () => {
    const policy = resolveAgentExecutionPolicy({
      kind: 'bulk_sprint_creation',
      requestedDryRun: false,
      allowWriteActions: true,
      requireApprovalForWrites: false,
      aiOversight: 'review_required',
    });

    expect(policy.dryRun).toBe(true);
    expect(policy.disposition).toBe('preview_approval_required');
  });

  it('allows live writes only when every write guard permits them', () => {
    const policy = resolveAgentExecutionPolicy({
      kind: 'backlog_triage',
      requestedDryRun: false,
      allowWriteActions: true,
      requireApprovalForWrites: false,
      aiOversight: 'auto',
    });

    expect(policy).toMatchObject({ dryRun: false, forcedDryRun: false, disposition: 'live' });
  });

  it('does not label read-only planning runs as forced previews', () => {
    const policy = resolveAgentExecutionPolicy({
      kind: 'sprint_planning',
      requestedDryRun: false,
      allowWriteActions: false,
      requireApprovalForWrites: true,
      aiOversight: 'review_required',
    });

    expect(policy).toMatchObject({
      dryRun: false,
      forcedDryRun: false,
      writeCapable: false,
      disposition: 'read_only',
    });
  });
});

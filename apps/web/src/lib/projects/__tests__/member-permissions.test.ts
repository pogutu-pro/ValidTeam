import { resolveProjectMemberPermission } from '../member-permissions';

describe('resolveProjectMemberPermission', () => {
  it('preserves explicit grants and denials over role defaults', () => {
    expect(resolveProjectMemberPermission('true', false)).toBe(true);
    expect(resolveProjectMemberPermission(true, false)).toBe(true);
    expect(resolveProjectMemberPermission('false', true)).toBe(false);
    expect(resolveProjectMemberPermission(false, true)).toBe(false);
  });

  it('uses the role default only for missing legacy values', () => {
    expect(resolveProjectMemberPermission(null, true)).toBe(true);
    expect(resolveProjectMemberPermission(undefined, false)).toBe(false);
  });
});

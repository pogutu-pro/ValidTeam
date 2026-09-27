/**
 * @jest-environment node
 */

import { resolveProjectChatPermissions } from '../access';

describe('resolveProjectChatPermissions', () => {
  it('does not let a stale project membership survive organization removal', () => {
    const result = resolveProjectChatPermissions({
      orgRole: null,
      isSuperAdmin: false,
      projectMembership: {
        role: 'developer',
        canBrowseProject: 'true',
        canBrowseChat: 'true',
        canPostMessages: 'true',
      },
    });

    expect(result.permissions.canBrowseProject).toBe(false);
    expect(result.permissions.canBrowseChat).toBe(false);
    expect(result.permissions.canPostMessages).toBe(false);
  });

  it('honors active organization and project membership permissions', () => {
    const result = resolveProjectChatPermissions({
      orgRole: 'member',
      isSuperAdmin: false,
      projectMembership: {
        role: 'developer',
        canBrowseProject: 'true',
        canBrowseChat: 'true',
        canPostMessages: 'false',
      },
    });

    expect(result.permissions.canBrowseProject).toBe(true);
    expect(result.permissions.canBrowseChat).toBe(true);
    expect(result.permissions.canPostMessages).toBe(false);
  });

  it('retains the explicit super-admin recovery path', () => {
    const result = resolveProjectChatPermissions({
      orgRole: null,
      isSuperAdmin: true,
      projectMembership: null,
    });

    expect(result.hasOrgProjectManagement).toBe(true);
    expect(Object.values(result.permissions).every(Boolean)).toBe(true);
  });
});

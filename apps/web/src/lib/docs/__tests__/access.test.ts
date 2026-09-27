/**
 * @jest-environment node
 */

import { resolveDocumentProjectListingMode } from '../access';

describe('resolveDocumentProjectListingMode', () => {
  it('denies stale project memberships after organization removal', () => {
    expect(resolveDocumentProjectListingMode({ orgRole: null, isSuperAdmin: false })).toBe('none');
  });

  it('uses scoped project memberships for an active ordinary member', () => {
    expect(resolveDocumentProjectListingMode({ orgRole: 'member', isSuperAdmin: false })).toBe(
      'memberships'
    );
  });

  it.each(['owner', 'admin'] as const)('shows every project to an organization %s', (orgRole) => {
    expect(resolveDocumentProjectListingMode({ orgRole, isSuperAdmin: false })).toBe('all');
  });

  it('retains the explicit super-admin recovery path', () => {
    expect(resolveDocumentProjectListingMode({ orgRole: null, isSuperAdmin: true })).toBe('all');
  });
});

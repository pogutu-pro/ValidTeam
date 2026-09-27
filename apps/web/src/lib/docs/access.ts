import { hasPermission as roleHasPermission } from '@tasknebula/db';
import type { OrgDocumentRole } from './server';

export type DocumentProjectListingMode = 'all' | 'memberships' | 'none';

/**
 * Project rows are subordinate to an active organization role. Owners/admins
 * (and platform super admins) see the complete project catalog; ordinary
 * members see only their project memberships; removed members see nothing.
 */
export function resolveDocumentProjectListingMode(input: {
  orgRole: OrgDocumentRole;
  isSuperAdmin: boolean;
}): DocumentProjectListingMode {
  if (roleHasPermission(input.orgRole || '', 'project:manage', input.isSuperAdmin)) {
    return 'all';
  }
  return input.orgRole ? 'memberships' : 'none';
}

/**
 * @jest-environment node
 */

const selectMock = jest.fn();

jest.mock('@tasknebula/db', () => ({
  db: { select: (...args: unknown[]) => selectMock(...args) },
  featureFlags: { key: 'featureFlags.key', isEnabled: 'featureFlags.isEnabled' },
  organizations: { id: 'organizations.id' },
}));

jest.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
}));

import {
  getEnabledFeatures,
  isFeatureEnabled,
  isProductFeatureEnabled,
  PRODUCT_FEATURE_FLAGS,
} from '../feature-flags';

function rows(result: unknown[]) {
  const builder = {
    from: jest.fn(() => builder),
    where: jest.fn(() => builder),
    limit: jest.fn().mockResolvedValue(result),
  };
  return builder;
}

const enabledFlag = {
  key: 'example',
  isEnabled: true,
  enabledForOrganizations: [],
  enabledForPlans: [],
  rolloutPercentage: 100,
};

describe('feature flag evaluation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps ad-hoc flags disabled when the key is missing', async () => {
    selectMock.mockReturnValue(rows([]));
    await expect(isFeatureEnabled('missing', 'org-1')).resolves.toBe(false);
  });

  it('keeps a product feature at its prior default until an admin configures the key', async () => {
    selectMock.mockReturnValue(rows([]));
    await expect(
      isProductFeatureEnabled(PRODUCT_FEATURE_FLAGS.AI_ISSUE_DRAFTING, 'org-1')
    ).resolves.toBe(true);
  });

  it('fails closed for suspended organizations even when the flag is enabled', async () => {
    selectMock
      .mockReturnValueOnce(rows([enabledFlag]))
      .mockReturnValueOnce(rows([{ id: 'org-1', plan: 'enterprise', status: 'suspended' }]));

    await expect(isFeatureEnabled('example', 'org-1')).resolves.toBe(false);
  });

  it('honors organization and plan targeting', async () => {
    selectMock
      .mockReturnValueOnce(
        rows([
          {
            ...enabledFlag,
            enabledForOrganizations: ['org-1'],
            enabledForPlans: ['enterprise'],
          },
        ])
      )
      .mockReturnValueOnce(rows([{ id: 'org-1', plan: 'enterprise', status: 'active' }]));

    await expect(isFeatureEnabled('example', 'org-1')).resolves.toBe(true);
  });

  it('does not turn a default-on product feature on when the database fails', async () => {
    selectMock.mockImplementation(() => {
      throw new Error('database unavailable');
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      isProductFeatureEnabled(PRODUCT_FEATURE_FLAGS.AI_ISSUE_DRAFTING, 'org-1')
    ).resolves.toBe(false);
    errorSpy.mockRestore();
  });

  it('returns no enabled keys for a suspended organization', async () => {
    selectMock
      .mockReturnValueOnce(rows([enabledFlag]))
      .mockReturnValueOnce(rows([{ id: 'org-1', plan: 'enterprise', status: 'suspended' }]));

    await expect(getEnabledFeatures('org-1')).resolves.toEqual([]);
  });
});

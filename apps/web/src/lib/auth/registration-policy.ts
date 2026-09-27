import { createId } from '@paralleldrive/cuid2';
import { db, eq, systemSettings } from '@tasknebula/db';

type RegistrationPolicyDbClient = Pick<typeof db, 'select' | 'insert'>;

export const REGISTRATION_POLICY_KEY = 'registration_policy';

export const REGISTRATION_MODES = [
  'allow_registration',
  'invite_only',
  'admin_created_only',
] as const;

export type RegistrationMode = (typeof REGISTRATION_MODES)[number];

export type RegistrationPolicy = {
  mode: RegistrationMode;
  updatedAt?: string;
  updatedBy?: string;
};

export const DEFAULT_REGISTRATION_POLICY: RegistrationPolicy = {
  mode: 'allow_registration',
};

export function isRegistrationMode(value: unknown): value is RegistrationMode {
  return typeof value === 'string' && REGISTRATION_MODES.includes(value as RegistrationMode);
}

export function normalizeRegistrationPolicy(value: unknown): RegistrationPolicy {
  const raw = (value as Record<string, unknown>) || {};
  const modeCandidate = typeof value === 'string' ? value : raw.mode;

  return {
    mode: isRegistrationMode(modeCandidate) ? modeCandidate : DEFAULT_REGISTRATION_POLICY.mode,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : undefined,
  };
}

export async function getRegistrationPolicy(
  client: RegistrationPolicyDbClient = db
): Promise<RegistrationPolicy> {
  const [setting] = await client
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, REGISTRATION_POLICY_KEY))
    .limit(1);

  return normalizeRegistrationPolicy(setting?.value);
}

export async function upsertRegistrationPolicy(
  mode: RegistrationMode,
  userId: string,
  client: RegistrationPolicyDbClient = db
): Promise<RegistrationPolicy> {
  const next: RegistrationPolicy = {
    mode,
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
  };

  await client
    .insert(systemSettings)
    .values({
      id: createId(),
      key: REGISTRATION_POLICY_KEY,
      category: 'security',
      description: 'Controls who can create ValidTeam accounts through public signup.',
      value: next,
      updatedBy: userId,
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: next, updatedAt: new Date(), updatedBy: userId },
    });

  return next;
}

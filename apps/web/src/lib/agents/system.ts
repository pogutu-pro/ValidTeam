import { createId } from '@paralleldrive/cuid2';
import { db, eq, systemSettings } from '@validteam/db';
import {
  DEFAULT_SYSTEM_AGENT_CONTROL_SETTINGS,
  normalizeSystemAgentControlSettings,
  type SystemAgentControlSettings,
} from './config';

export const SYSTEM_AGENT_CONTROL_KEY = 'agent_control_center';
export const SYSTEM_AGENT_CONTROL_ADVISORY_LOCK = 'validteam:agent-control-settings:v1';

type AgentControlDbClient = Pick<typeof db, 'select' | 'insert'>;

export async function getSystemAgentControlSettingsFromDb(
  client: AgentControlDbClient = db
): Promise<SystemAgentControlSettings> {
  const [setting] = await client
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, SYSTEM_AGENT_CONTROL_KEY))
    .limit(1);

  return normalizeSystemAgentControlSettings(setting?.value);
}

export async function upsertSystemAgentControlSettings(
  value: SystemAgentControlSettings,
  userId: string,
  client: AgentControlDbClient = db
) {
  const now = new Date();
  const [saved] = await client
    .insert(systemSettings)
    .values({
      id: createId(),
      key: SYSTEM_AGENT_CONTROL_KEY,
      category: 'features',
      description: 'Global controls for ValidTeam AI and agentic execution.',
      value,
      updatedBy: userId,
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value, updatedAt: now, updatedBy: userId },
    })
    .returning();

  return saved;
}

export function ensureSystemAgentControlSettings(value: unknown): SystemAgentControlSettings {
  return normalizeSystemAgentControlSettings(value ?? DEFAULT_SYSTEM_AGENT_CONTROL_SETTINGS);
}

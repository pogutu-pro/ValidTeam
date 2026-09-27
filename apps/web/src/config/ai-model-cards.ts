/**
 * Technical metadata for TaskNebula's documented AI features.
 *
 * User-facing names and descriptions live under `aiModelCards.features` in
 * all locale catalogs. This module intentionally contains only identifiers,
 * configurable defaults, and control metadata. It is not, by itself, a legal
 * classification or compliance determination.
 */

/** Bump this whenever the transparency copy materially changes. */
export const DISCLOSURE_VERSION = '2026-08-12.1';

export type AiFeatureId = 'draft' | 'assist' | 'triage' | 'ask' | 'summary' | 'embedding';

export interface AiFeatureModelCard {
  id: AiFeatureId;
  /** Default identifier; the active workspace configuration may differ. */
  defaultModel: string;
  /** Default provider route; workspace/deployment configuration may differ. */
  defaultProvider: 'anthropic' | 'openai' | 'azure' | 'native' | 'custom';
  /** Conservative product-policy default for write-capable actions. */
  defaultOversight: 'auto' | 'review_required';
  /** Whether the feature can produce content shown directly to a user. */
  userFacing: boolean;
}

export const AI_FEATURE_MODEL_CARDS: readonly AiFeatureModelCard[] = [
  {
    id: 'draft',
    defaultModel: 'claude-sonnet-4-6',
    defaultProvider: 'anthropic',
    defaultOversight: 'review_required',
    userFacing: true,
  },
  {
    id: 'assist',
    defaultModel: 'claude-sonnet-4-6',
    defaultProvider: 'anthropic',
    defaultOversight: 'review_required',
    userFacing: true,
  },
  {
    id: 'triage',
    defaultModel: 'claude-sonnet-4-6',
    defaultProvider: 'anthropic',
    defaultOversight: 'review_required',
    userFacing: true,
  },
  {
    id: 'ask',
    defaultModel: 'claude-sonnet-4-6',
    defaultProvider: 'anthropic',
    defaultOversight: 'auto',
    userFacing: true,
  },
  {
    id: 'summary',
    defaultModel: 'claude-sonnet-4-6',
    defaultProvider: 'anthropic',
    defaultOversight: 'auto',
    userFacing: true,
  },
  {
    id: 'embedding',
    defaultModel: 'text-embedding-3-small',
    defaultProvider: 'openai',
    defaultOversight: 'auto',
    userFacing: false,
  },
] as const;

export function getAiFeatureCard(id: AiFeatureId): AiFeatureModelCard | undefined {
  return AI_FEATURE_MODEL_CARDS.find((card) => card.id === id);
}

export const USER_FACING_AI_FEATURES: readonly AiFeatureModelCard[] = AI_FEATURE_MODEL_CARDS.filter(
  (card) => card.userFacing
);

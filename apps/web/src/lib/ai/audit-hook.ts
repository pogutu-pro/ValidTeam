/**
 * Optional audit hook for AI provider calls.
 *
 * The primary budget path persists `cached_tokens` in `llm_call_audit`.
 * Agent-provider calls do not have that budget context, so this secondary
 * hook emits a structured console log that a metrics scraper (Datadog/Loki)
 * can use to tally cache hit rates.
 *
 * Callers MUST treat this hook as optional and never throw out of it.
 */

export interface PromptCacheUsageRecord {
  provider: 'anthropic' | 'openai';
  model: string;
  inputTokens: number;
  outputTokens: number;
  /**
   * Number of input tokens served from cache. Maps to
   * Anthropic's `cache_read_input_tokens` and OpenAI's
   * `usage.prompt_tokens_details.cached_tokens`.
   */
  cachedTokens: number;
  /**
   * Anthropic-only — tokens consumed when populating the cache for the
   * first time (charged at 1.25x the standard input rate).
   */
  cacheCreationTokens?: number;
}

export function recordPromptCacheUsage(record: PromptCacheUsageRecord): void {
  // Defensive: never let logging break a request.
  try {
    const safe = {
      provider: record.provider,
      model: record.model,
      inputTokens: Number.isFinite(record.inputTokens) ? record.inputTokens : 0,
      outputTokens: Number.isFinite(record.outputTokens) ? record.outputTokens : 0,
      cachedTokens: Number.isFinite(record.cachedTokens) ? record.cachedTokens : 0,
      cacheCreationTokens: Number.isFinite(record.cacheCreationTokens ?? 0)
        ? (record.cacheCreationTokens ?? 0)
        : 0,
    };
    // Structured fallback log line, suitable for a Loki/Datadog parser.
    // eslint-disable-next-line no-console
    console.info('[ai.cache.usage]', JSON.stringify(safe));
  } catch {
    // ignore
  }
}

const DEFAULT_PROVIDER_TIMEOUT_MS = 120_000;
const MAX_PROVIDER_TIMEOUT_MS = 10 * 60_000;

export type ProviderAbortKind = 'caller' | 'timeout' | null;

export interface ProviderDeadline {
  signal: AbortSignal;
  abortKind: () => ProviderAbortKind;
  dispose: () => void;
}

/**
 * Compose a caller cancellation signal with a finite provider deadline.
 * The returned signal stays active until `dispose`, so it also bounds
 * streaming response-body reads rather than only the initial HTTP headers.
 */
export function createProviderDeadline(
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
): ProviderDeadline {
  const requestedTimeout = options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const timeoutMs =
    Number.isFinite(requestedTimeout) && requestedTimeout > 0
      ? Math.min(Math.floor(requestedTimeout), MAX_PROVIDER_TIMEOUT_MS)
      : DEFAULT_PROVIDER_TIMEOUT_MS;
  const controller = new AbortController();
  let kind: ProviderAbortKind = null;

  const abort = (nextKind: Exclude<ProviderAbortKind, null>, reason?: unknown) => {
    if (controller.signal.aborted) return;
    kind = nextKind;
    controller.abort(reason);
  };
  const abortFromCaller = () => abort('caller', options.signal?.reason);

  if (options.signal?.aborted) abortFromCaller();
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });

  const timer = setTimeout(() => {
    abort('timeout', new Error(`Provider request exceeded ${timeoutMs}ms.`));
  }, timeoutMs);
  timer.unref?.();

  return {
    signal: controller.signal,
    abortKind: () => kind,
    dispose() {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

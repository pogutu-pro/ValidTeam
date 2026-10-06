import { after } from 'next/server';

/**
 * Run work after the HTTP response has been sent, without being cut off when the
 * handler returns (Next's `after`). Outside a request (scripts, tests) it simply
 * runs now. Failures are logged, never thrown into the request.
 */
export function runAfterResponse(label: string, task: () => Promise<unknown>): void {
  const guarded = async () => {
    try {
      await task();
    } catch (error) {
      console.error(`[meetings] ${label} failed:`, error instanceof Error ? error.message : error);
    }
  };
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}

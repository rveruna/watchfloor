export interface BackoffOptions {
  /** The wait after the first failure, before randomness. */
  baseMs: number;
  /** The longest the wait can grow to. */
  maxMs: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 500, maxMs: 30_000 };

/**
 * How long to wait before trying again after `attempt` failures in a row (the first failure is attempt 1). Doubles each
 * time up to a ceiling, then picks a random point below it ("full jitter"), so a hundred clients that lost the server
 * together do not all come back at the same instant and knock it over again.
 */
export function backoffDelay(
  attempt: number,
  random: () => number,
  { baseMs, maxMs } = DEFAULT_BACKOFF,
): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  // never exactly zero, so a retry loop cannot spin
  return Math.max(1, Math.floor(random() * ceiling));
}

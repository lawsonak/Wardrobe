// Resilient fetch helper for client-side AI calls.
//
// iOS Safari and flaky LTE both surface a useless "Load failed" when
// a fetch is aborted, the connection drops, or the request times
// out. This wrapper:
//
//   - Wraps the fetch in an AbortController with a configurable
//     timeout (default 30s).
//   - Retries once on network/timeout failures (NOT on 4xx/5xx).
//   - Maps the cryptic native errors to a user-friendly message.

const TRANSIENT_ERR =
  /load failed|failed to fetch|aborted|timed out|networkerror|connection|reset/i;

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  opts: { retries?: number; timeoutMs?: number; onRetry?: (attempt: number) => void } = {},
): Promise<Response> {
  const { retries = 1, timeoutMs = 30_000, onRetry } = opts;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      onRetry?.(attempt);
      await new Promise((r) => setTimeout(r, 1_000 * attempt));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...(init ?? {}), signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      lastErr = controller.signal.aborted ? new Error("Request timed out") : err;
      // 4xx/5xx don't end up here (fetch resolves), so any error is
      // treated as transient and eligible for retry.
      if (!TRANSIENT_ERR.test(msg) && !controller.signal.aborted) {
        // Unknown error type — bail without another retry.
        throw lastErr;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Map an Error from fetchWithRetry into a user-facing one-liner. */
export function friendlyFetchError(err: unknown, fallback = "Something went wrong."): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (TRANSIENT_ERR.test(msg)) {
    return "Couldn't reach the server — check your connection and try again.";
  }
  return msg || fallback;
}

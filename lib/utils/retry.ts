// ---------------------------------------------------------------------------
// Shared retry utility with exponential backoff
// ---------------------------------------------------------------------------
// Used by all API-calling tools for rate-limit resilience.
// ---------------------------------------------------------------------------

export interface RetryOptions {
  /** Maximum number of retry attempts (default 2 = up to 3 total calls) */
  maxRetries?: number;
  /** Initial delay in ms before first retry (default 1000) */
  baseDelayMs?: number;
  /** Multiplier applied to delay after each retry (default 2) */
  backoffMultiplier?: number;
  /** Maximum delay cap in ms (default 10000) */
  maxDelayMs?: number;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 2,
  baseDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 10000,
};

/**
 * Checks if an HTTP status code is retryable (rate limit or server error).
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps an async function with retry logic and exponential backoff.
 * Only retries on errors that look like rate limits or transient failures.
 *
 * @param fn      The async function to execute
 * @param options Retry configuration
 * @returns       The result of the function, or throws after all retries exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      const isRateLimit =
        lastError.message.includes("429") ||
        lastError.message.toLowerCase().includes("rate limit") ||
        lastError.message.toLowerCase().includes("rate_limit") ||
        lastError.message.toLowerCase().includes("too many requests") ||
        lastError.message.toLowerCase().includes("quota") ||
        lastError.message.toLowerCase().includes("token") ||
        lastError.message.toLowerCase().includes("capacity") ||
        lastError.message.toLowerCase().includes("overloaded") ||
        lastError.message.toLowerCase().includes("empty response");

      const isServerError =
        lastError.message.includes("500") ||
        lastError.message.includes("502") ||
        lastError.message.includes("503");

      if (!isRateLimit && !isServerError) {
        throw lastError; // Non-retryable error
      }

      if (attempt < opts.maxRetries) {
        const baseDelay = Math.min(
          opts.baseDelayMs * Math.pow(opts.backoffMultiplier, attempt),
          opts.maxDelayMs
        );
        // Add ±25% jitter to prevent thundering herd when multiple requests retry simultaneously
        const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
        const delay = Math.max(0, Math.round(baseDelay + jitter));
        console.warn(
          `[Retry] Attempt ${attempt + 1}/${opts.maxRetries} failed (${lastError.message}). ` +
            `Retrying in ${delay}ms...`
        );
        await sleep(delay);
      }
    }
  }

  throw lastError!;
}

/**
 * Wraps a fetch call with retry logic. Returns the Response object.
 * Throws on retryable HTTP status codes to trigger retry.
 */
export async function fetchWithRetry(
  input: string | URL | Request,
  init?: RequestInit,
  options?: RetryOptions
): Promise<Response> {
  return withRetry(async () => {
    const response = await fetch(input, init);

    if (isRetryableStatus(response.status)) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `HTTP ${response.status}: ${body.slice(0, 200)}`
      );
    }

    return response;
  }, options);
}

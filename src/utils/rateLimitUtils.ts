/**
 * Utility functions for rate limit error detection and handling
 */

/**
 * Detects if an error is a rate limit error by checking multiple indicators:
 * - Error message contains rate limit keywords
 * - Error status is 429 (HTTP Too Many Requests)
 * - Error message contains "429" string
 *
 * @param error The error object to check
 * @returns true if the error is identified as a rate limit error
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const err = error as Record<string, unknown>;
  const errorMessage: string = (err.message as string) || "";
  return (
    errorMessage.includes("Request rate limit exceeded") ||
    errorMessage.includes("RATE_LIMIT_EXCEEDED") ||
    errorMessage.includes("429") ||
    err.status === 429
  );
}

/**
 * Extracts the retry time from a rate limit error message
 * @param error The rate limit error object
 * @returns The retry time string if found, or 'some time' as fallback
 */
export function extractRetryTime(error: unknown): string {
  const err = error as Record<string, unknown> | null | undefined;
  const errorMessage: string = (err?.message as string) || "";
  const retryMatch = errorMessage.match(/Try again in ([\d\w\s]+)/);
  return retryMatch ? retryMatch[1] : "some time";
}

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
export function isRateLimitError(error: any): boolean {
  if (!error || typeof error !== "object") return false;

  const errorMessage = error.message || error.toString();
  return (
    errorMessage.includes("Request rate limit exceeded") ||
    errorMessage.includes("RATE_LIMIT_EXCEEDED") ||
    errorMessage.includes("429") ||
    error.status === 429
  );
}

/**
 * Extracts the retry time from a rate limit error message
 * @param error The rate limit error object
 * @returns The retry time string if found, or 'some time' as fallback
 */
export function extractRetryTime(error: any): string {
  const errorMessage = error?.message || error?.toString() || "";
  const retryMatch = errorMessage.match(/Try again in ([\d\w\s]+)/);
  return retryMatch ? retryMatch[1] : "some time";
}

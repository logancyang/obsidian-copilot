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

export function extractRetryTime(error: unknown): string {
  const err = error as Record<string, unknown> | null | undefined;
  const errorMessage: string = (err?.message as string) || "";
  const retryMatch = errorMessage.match(/Try again in ([\d\w\s]+)/);
  return retryMatch ? retryMatch[1] : "some time";
}

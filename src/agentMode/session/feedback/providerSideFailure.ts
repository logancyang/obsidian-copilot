const PROVIDER_SIDE_CATEGORIES: ReadonlySet<string> = new Set([
  // OpenCode and Codex name the failure in the JSON-RPC error data, so a provider's new wording needs no new pattern.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/810
  "provider.quota",
  "provider.rate-limit",
  "provider.free-limit",
  "provider.go-limit",
  "provider.budget-limit",
  "provider.model-budget-limit",
  "provider.chatgpt-limit",
  "usageLimitExceeded",
  // A provider API that refuses or drops the connection is the user's network or endpoint state.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/826
  "provider.transport",
]);

const PROVIDER_SIDE_PATTERNS: readonly RegExp[] = [
  // Claude sends no category, and OpenCode files OpenRouter's max_tokens affordability error as an invalid request.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/810
  /hit your (?:\w+ )?limit/i,
  /credit balance/i,
  /rate[ _-]?limit/i,
  /requires more credits/i,
  /\b(?:HTTP|status(?: code)?)[\s:]*(?:402|429)\b/i,
];

function failureCategory(error: unknown): unknown {
  const data: unknown = (error as { data?: unknown } | null)?.data;
  if (data === null || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  return record.errorName ?? record.codexErrorInfo;
}

export function isProviderSideFailure(error: unknown, errorText: string): boolean {
  const category = failureCategory(error);
  if (typeof category === "string" && PROVIDER_SIDE_CATEGORIES.has(category)) return true;
  return PROVIDER_SIDE_PATTERNS.some((pattern) => pattern.test(errorText));
}

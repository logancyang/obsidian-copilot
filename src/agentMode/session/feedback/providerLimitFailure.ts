const PROVIDER_LIMIT_PATTERNS: readonly RegExp[] = [
  /usage limit/i,
  /hit your (?:\w+ )?limit/i,
  /rate[ _-]?limit/i,
  /too many requests/i,
  /quota/i,
  /token_limit_error/i,
  /resource_exhausted/i,
  /credit balance/i,
  /insufficient (?:credits|funds|balance)/i,
  /payment required/i,
  /\b(?:HTTP|status(?: code)?)[\s:]*(?:402|429)\b/i,
];

// Out-of-quota, out-of-credit and rate-limited replies are the provider account's state, which the Copilot team can't act on.
// https://github.com/logancyang/obsidian-copilot/issues/3944
export function isProviderLimitFailure(errorText: string): boolean {
  return PROVIDER_LIMIT_PATTERNS.some((pattern) => pattern.test(errorText));
}

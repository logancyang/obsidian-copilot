const PROVIDER_SIDE_PATTERNS: readonly RegExp[] = [
  // Out-of-quota, out-of-credit and rate-limited replies are the provider account's state, which the Copilot team can't act on.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/810
  /usage limit/i,
  /hit your (?:\w+ )?limit/i,
  /rate[ _-]?limit/i,
  /too many requests/i,
  /quota/i,
  /token_limit_error/i,
  /resource_exhausted/i,
  /credit balance/i,
  /insufficient credits/i,
  /insufficient balance/i,
  /add (?:more )?credits/i,
  /\b(?:HTTP|status(?: code)?)[\s:]*(?:402|429)\b/i,
  // A provider API that refuses or drops the connection is the user's network or endpoint state, equally out of the team's reach.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/826
  /connection ?refused/i,
  /ECONN(?:REFUSED|RESET)/i,
];

export function isProviderSideFailure(errorText: string): boolean {
  return PROVIDER_SIDE_PATTERNS.some((pattern) => pattern.test(errorText));
}

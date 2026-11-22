export function maskSecretValues(text: string, values: readonly string[]): string {
  // A server can echo just the key of a "Bearer <key>" header value, so a value's last word is masked too.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/862
  return values
    .flatMap((value) => [value, value.split(/\s+/).pop() ?? ""])
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .reduce((masked, value) => masked.split(value).join("***"), text);
}

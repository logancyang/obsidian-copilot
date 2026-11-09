export function maskSecretValues(text: string, values: readonly string[]): string {
  return values
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .reduce((masked, value) => masked.split(value).join("***"), text);
}

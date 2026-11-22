const EMPTY_OPENCODE_ONLY: readonly string[] = Object.freeze([] as string[]);

function opencodeProviderIdOf(wireId: string): string {
  const slash = wireId.indexOf("/");
  return slash === -1 ? wireId : wireId.slice(0, slash);
}

export function partitionOpencodeOnlyWireIds(
  reportedWireIds: readonly string[],
  managedOpencodeIds: ReadonlySet<string>
): string[] {
  if (reportedWireIds.length === 0) return EMPTY_OPENCODE_ONLY as string[];
  const seen = new Set<string>();
  const opencodeOnly: string[] = [];
  for (const wireId of reportedWireIds) {
    if (seen.has(wireId)) continue;
    const providerId = opencodeProviderIdOf(wireId);
    if (managedOpencodeIds.has(providerId)) continue;
    seen.add(wireId);
    opencodeOnly.push(wireId);
  }
  if (opencodeOnly.length === 0) return EMPTY_OPENCODE_ONLY as string[];
  return opencodeOnly;
}

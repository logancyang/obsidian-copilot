/**
 * opencode bundles a full models.dev snapshot for every provider it holds a key
 * for, so its reported catalog floods with models Copilot already curates on
 * the BYOK / Plus tabs. These pure helpers keep only the "opencode-only" wire
 * ids — those hosted by a provider Copilot does NOT manage (opencode Zen
 * `opencode/*`, or a provider the user authed directly). The managed-provider
 * set is built by `buildManagedOpencodeProviderIds` and passed in.
 */

/** See AGENTS.md → "Referential stability". */
const EMPTY_OPENCODE_ONLY: readonly string[] = Object.freeze([] as string[]);

function opencodeProviderIdOf(wireId: string): string {
  const slash = wireId.indexOf("/");
  return slash === -1 ? wireId : wireId.slice(0, slash);
}

/**
 * Keep only wire ids whose provider isn't in `managedOpencodeIds`. Ids hosted
 * by a Copilot-managed provider are dropped (curated on the BYOK tab, must not
 * be re-enrolled as agent-origin). Order follows the input; duplicates are
 * dropped so a flooded catalog never enrolls a model twice.
 */
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

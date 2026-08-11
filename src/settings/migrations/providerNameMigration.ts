import {
  allocateUniqueProviderDisplayName,
  normalizeProviderDisplayName,
  providerDisplayNameKey,
  type Provider,
} from "@/modelManagement";

interface ProviderNameCandidate {
  mapKey: string;
  provider: Provider;
  normalizedName: string;
}

function fallbackProviderName(provider: Provider): string {
  const readableType = provider.providerType
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return `${readableType || "Unnamed"} Provider`;
}

function normalizedLegacyName(provider: Provider): string {
  try {
    return normalizeProviderDisplayName(provider.displayName);
  } catch {
    return fallbackProviderName(provider);
  }
}

function compareCandidates(a: ProviderNameCandidate, b: ProviderNameCandidate): number {
  const aAddedAt = Number.isFinite(a.provider.addedAt)
    ? a.provider.addedAt
    : Number.MAX_SAFE_INTEGER;
  const bAddedAt = Number.isFinite(b.provider.addedAt)
    ? b.provider.addedAt
    : Number.MAX_SAFE_INTEGER;
  if (aAddedAt !== bAddedAt) return aAddedAt - bAddedAt;
  const providerIdOrder = a.provider.providerId.localeCompare(b.provider.providerId);
  return providerIdOrder || a.mapKey.localeCompare(b.mapKey);
}

/**
 * Repair every persisted provider name into the global uniqueness invariant.
 * Returns null when no row changes so current vaults keep their providers-map reference.
 */
export function planProviderNameMigration(
  providers: Record<string, Provider>
): Record<string, Provider> | null {
  const candidates = Object.entries(providers).map(([mapKey, provider]) => ({
    mapKey,
    provider,
    normalizedName: normalizedLegacyName(provider),
  }));
  const groups = new Map<string, ProviderNameCandidate[]>();
  for (const candidate of candidates) {
    const key = providerDisplayNameKey(candidate.normalizedName);
    const group = groups.get(key);
    if (group) group.push(candidate);
    else groups.set(key, [candidate]);
  }

  const reservedNames = [...groups.values()].map((group) => group[0].normalizedName);
  const migratedNames = new Map<string, string>();
  for (const [, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const ordered = [...group].sort(compareCandidates);
    migratedNames.set(ordered[0].mapKey, ordered[0].normalizedName);
    for (const duplicate of ordered.slice(1)) {
      const uniqueName = allocateUniqueProviderDisplayName(duplicate.normalizedName, reservedNames);
      migratedNames.set(duplicate.mapKey, uniqueName);
      reservedNames.push(uniqueName);
    }
  }

  let changed = false;
  const migrated: Record<string, Provider> = {};
  for (const candidate of candidates) {
    const displayName = migratedNames.get(candidate.mapKey)!;
    if (candidate.provider.displayName === displayName) {
      migrated[candidate.mapKey] = candidate.provider;
    } else {
      migrated[candidate.mapKey] = { ...candidate.provider, displayName };
      changed = true;
    }
  }
  return changed ? migrated : null;
}

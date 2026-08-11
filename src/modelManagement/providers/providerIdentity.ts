import { md5 } from "@/utils/hash";

const MAX_SECRET_ID_LENGTH = 64;
const PROVIDER_NAME_TOKEN_LENGTH = 8;
const PROVIDER_TOKEN_LENGTH = 8;

/** Return the canonical comparison key used by the global uniqueness invariant. */
export function providerDisplayNameKey(displayName: string): string {
  return normalizeProviderDisplayName(displayName).normalize("NFKC").toLowerCase();
}

function readableKeychainSegment(displayName: string): string {
  const normalizedDisplayName = normalizeProviderDisplayName(displayName);
  let segment = "";
  for (const character of normalizedDisplayName.normalize("NFKD")) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint >= 0x0300 && codePoint <= 0x036f) continue;

    if (/^[a-z0-9]$/i.test(character)) {
      segment += character.toLowerCase();
    } else if (codePoint <= 0x7f) {
      segment += "-";
    } else {
      segment += `-u${codePoint.toString(16)}-`;
    }
  }
  const readableSegment = segment.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  if (readableSegment) return readableSegment;

  return Array.from(
    normalizedDisplayName,
    (character) => `u${character.codePointAt(0)!.toString(16)}`
  ).join("-");
}

/** Normalize a provider's persisted, user-visible identity. */
export function normalizeProviderDisplayName(displayName: string): string {
  const normalized = displayName.trim();
  if (!normalized) {
    throw new Error("Provider name cannot be empty");
  }
  return normalized;
}

/**
 * Allocate a unique provider name without changing the requested name unless it collides.
 *
 * @param requestedName - User-visible name requested for the provider.
 * @param reservedNames - Names already owned by other providers.
 */
export function allocateUniqueProviderDisplayName(
  requestedName: string,
  reservedNames: Iterable<string>
): string {
  const baseName = normalizeProviderDisplayName(requestedName);
  const reserved = new Set<string>();
  for (const name of reservedNames) {
    const normalized = name.trim();
    if (normalized) reserved.add(providerDisplayNameKey(normalized));
  }
  if (!reserved.has(providerDisplayNameKey(baseName))) return baseName;

  let suffix = 2;
  while (reserved.has(providerDisplayNameKey(`${baseName} ${suffix}`))) {
    suffix += 1;
  }
  return `${baseName} ${suffix}`;
}

/** Return the stable suffix used to discover a provider's prior readable IDs. */
export function providerKeychainStableToken(providerId: string): string {
  return md5(providerId).slice(0, PROVIDER_TOKEN_LENGTH);
}

/**
 * Build the readable, vault-scoped SecretStorage ID for a provider credential.
 * A display-name fingerprint distinguishes names whose readable segments normalize
 * or truncate identically. The final provider token remains stable across renames.
 * The short provider token keeps the mapping recoverable when a renamed provider
 * reaches another device before that device has moved its local keychain entry.
 *
 * @param vaultId - Stable vault namespace owned by KeychainService.
 * @param displayName - Provider's unique persisted display name.
 * @param providerId - Provider's immutable UUID.
 */
export function buildProviderKeychainId(
  vaultId: string,
  displayName: string,
  providerId: string
): string {
  if (!/^[a-z0-9]+$/.test(vaultId)) {
    throw new Error("Vault keychain ID must contain only lowercase alphanumeric characters");
  }

  const prefix = `copilot-v${vaultId}-provider-`;
  const normalizedDisplayName = normalizeProviderDisplayName(displayName).normalize("NFKC");
  const nameToken = md5(normalizedDisplayName).slice(0, PROVIDER_NAME_TOKEN_LENGTH);
  const token = providerKeychainStableToken(providerId);
  const suffix = `-${nameToken}-${token}`;
  const nameBudget = MAX_SECRET_ID_LENGTH - prefix.length - suffix.length;
  if (nameBudget < 1) {
    throw new Error("Vault keychain ID is too long for provider credentials");
  }

  const readableName = readableKeychainSegment(displayName).slice(0, nameBudget).replace(/-+$/, "");
  return `${prefix}${readableName}${suffix}`;
}

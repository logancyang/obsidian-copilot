/**
 * Type augmentation for Obsidian SecretStorage API (available since 1.11.4).
 *
 * Reason: the npm package `obsidian@1.2.5` does not include SecretStorage
 * types. This augmentation adds them so TypeScript can type-check our
 * keychain integration without runtime changes.
 *
 * The actual Obsidian SecretStorage API is synchronous (returns values directly,
 * not Promises). KeychainService wraps these with an async facade to minimise
 * call-site changes, but the type declarations must match the real runtime API.
 */
import "obsidian";

declare module "obsidian" {
  interface App {
    /** OS-level secret storage backed by the system keychain. Available since Obsidian 1.11.4. */
    secretStorage?: SecretStorage;
  }

  interface SecretStorage {
    /** Store a secret under the given identifier. */
    setSecret(id: string, secret: string): void;

    /** Retrieve a secret by identifier. Returns `null` if not found. */
    getSecret(id: string): string | null;

    /** List all stored secret identifiers. */
    listSecrets(): string[];

    // Reason: `deleteSecret` is NOT declared here because the official
    // Obsidian documentation only lists the three methods above.
    // Use `setSecret(id, "")` to clear a secret instead.
  }
}

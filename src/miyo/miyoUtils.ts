import {
  getMiyoStatusSnapshot,
  isMiyoAvailableForCapability,
  refreshMiyoStatus,
} from "@/miyo/miyoStatusStore";
import { shouldUseMiyo } from "@/miyo/miyoRuntimePolicy";
import { CopilotSettings, getSettings } from "@/settings/model";
import { App } from "obsidian";

// Re-exported from miyoRuntimePolicy so callers keep importing these from
// `@/miyo/miyoUtils`. They live in the policy module to break the
// miyoUtils ↔ miyoStatusStore import cycle.
export { getMiyoCustomUrl, shouldUseMiyo } from "@/miyo/miyoRuntimePolicy";

/**
 * Deeplink that launches (or focuses) the Miyo desktop app via its registered
 * URL scheme. Used to send users straight into Miyo to register their vault
 * folder instead of asking them to open the app manually.
 */
export const MIYO_DEEPLINK_URL = "miyo://";

/**
 * Deeplink into Miyo's "add folder" screen. Used as the fallback for a remote
 * Miyo (which can't see this machine's local vault path) or when we otherwise
 * can't auto-register: it drops the user straight onto the add-folder flow in
 * the desktop app instead of the generic launch.
 */
export const MIYO_ADD_FOLDER_DEEPLINK_URL = `${MIYO_DEEPLINK_URL}add-folder`;

/**
 * Deeplink into Miyo's Relay (Connector) setup screen — the "Set up in Miyo"
 * action on the Relay capability row lands the user there directly rather than
 * on Miyo's generic landing.
 */
export const MIYO_CONNECT_DEEPLINK_URL = `${MIYO_DEEPLINK_URL}connect`;

/**
 * Deeplink into Miyo's chat-sources / indexing screen — the "Manage in Miyo"
 * action on the Search-chat capability row lands the user straight on chat sync.
 */
export const MIYO_CHATS_DEEPLINK_URL = `${MIYO_DEEPLINK_URL}chats`;

/**
 * Whether a configured Miyo endpoint points at THIS machine, so an absolute
 * local vault path is meaningful to it.
 *
 * An empty custom URL means local discovery (Miyo found on localhost) → local.
 * An explicit URL is local only when its host is loopback; a LAN/public host is
 * treated as remote so we never POST a local filesystem path a remote server
 * can't resolve. An unparseable URL is treated as remote — the safe default,
 * since the worst case is falling back to the manual add flow.
 *
 * @param customUrl - The configured Miyo server URL (may be empty).
 * @returns True when Miyo runs locally and can index a local absolute path.
 */
export function isLocalMiyoUrl(customUrl: string): boolean {
  if (!customUrl.trim()) {
    return true;
  }
  try {
    // Strip IPv6 brackets so "[::1]" compares as "::1".
    const hostname = new URL(customUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "::1" ||
      /^127(?:\.\d{1,3}){3}$/.test(hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Convert backslashes to forward slashes and trim trailing slashes.
 *
 * @param path - Filesystem path.
 * @returns Normalized path.
 */
function normalizeFilesystemPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Per-capability accessor: which engine backs vault search.
 *
 * Derives from the live {@link shouldUseMiyo} predicate, so every read-site
 * stays behavior-neutral. Keyword search is agent-native; Miyo is an
 * enhancement, so there is no persisted engine field to read.
 */
export function getSearchBackend(settings: CopilotSettings = getSettings()): "keyword" | "miyo" {
  return shouldUseMiyo(settings) ? "miyo" : "keyword";
}

/**
 * Compute the doc-processor backend to persist when seeding the field during a
 * settings migration.
 *
 * Kept separate from {@link resolveDocProcessorBackend}: the seed must be a pure,
 * deterministic function of the vault's old fields (its result is written into
 * `docProcessorBackend`), whereas the runtime resolver reads that field and
 * layers on live Miyo availability. Reusing the resolver to seed would be
 * circular (it would read the very field being computed) and non-deterministic
 * (it would depend on runtime connectivity at migration time).
 *
 * Reads the raw toggles off the passed `settings` rather than the runtime
 * `isSelfHostModeValid()` gate, which additionally consults the entitlement
 * verified this session — a migration must not depend on whether that
 * asynchronous verification has landed yet.
 *
 * @param settings - Settings being migrated.
 * @returns "miyo" when self-host mode and Miyo are both enabled, else "plus".
 */
export function seedDocProcessorBackend(
  settings: CopilotSettings = getSettings()
): "plus" | "miyo" {
  return settings.enableSelfHostMode && settings.enableMiyo ? "miyo" : "plus";
}

/**
 * Outcome of resolving the doc-processor backend at a parse boundary.
 *
 * `"miyo-unavailable"` is distinct from `"plus"`: it means the user EXPLICITLY
 * chose local Miyo processing but Miyo can't be confirmed reachable right now.
 * Callers must NOT silently route these documents to the cloud — see
 * {@link resolveDocProcessorBackend}.
 */
export type ResolvedDocProcessorBackend = "plus" | "miyo" | "miyo-unavailable";

/**
 * Async parse-boundary resolver for the document-processor backend.
 *
 * The Miyo status snapshot is only refreshed while the settings page is open — it
 * starts `unknown` and lazily degrades to `stale` after the horizon. So a user
 * who picked `"miyo"` but never opened settings (e.g. right after an Obsidian
 * restart) would have their documents routed by a not-yet-confirmed status. This
 * resolver closes that gap by probing once (single-flight + TTL-gated in the
 * store, so the hot path isn't spammed) when the preference is `"miyo"` and the
 * live status is inconclusive (`unknown`/`stale`), then applies a THREE-way
 * decision that keeps an explicit local choice private:
 *
 *   - `docProcessorBackend !== "miyo"` → `"plus"` (user chose cloud).
 *   - `docProcessorBackend === "miyo"` but Miyo isn't usable (`shouldUseMiyo`
 *     false — disconnected, or mobile without a remote URL) → `"miyo-unavailable"`.
 *     FAIL CLOSED: the user explicitly chose local processing, so a document is
 *     never silently uploaded to the cloud just because Miyo went away. The picker
 *     stays selectable so the user can switch to Plus to recover.
 *   - `docProcessorBackend === "miyo"` AND Miyo is in use, probe, then:
 *       - confirmed `available` → `"miyo"`.
 *       - still not available → `"miyo-unavailable"` (fail closed, same reason).
 *
 * DESIGN NOTE (locked): an EXPLICIT `docProcessorBackend === "miyo"` never falls
 * back to cloud on unavailability — it fails closed. Cloud is only used when the
 * user's effective choice is Plus (the field is `"plus"`). Do NOT "recover" a
 * miyo-unavailable outcome by routing to Plus to avoid an error — that
 * reintroduces the silent cloud-egress this guard exists to prevent.
 */
export async function resolveDocProcessorBackend(
  settings: CopilotSettings = getSettings()
): Promise<ResolvedDocProcessorBackend> {
  if (settings.docProcessorBackend !== "miyo") {
    return "plus";
  }
  if (!shouldUseMiyo(settings)) {
    return "miyo-unavailable";
  }
  const status = getMiyoStatusSnapshot().documentProcessor;
  if (status === "unknown" || status === "stale") {
    await refreshMiyoStatus();
  }
  return isMiyoAvailableForCapability("documentProcessor") ? "miyo" : "miyo-unavailable";
}

/**
 * Resolve the folder identifier sent to Miyo as `folder_name`.
 *
 * @param app - Obsidian application instance.
 * @returns Vault folder name.
 */
export function getMiyoFolderName(app: App): string {
  return app.vault.getName();
}

/**
 * Build the portable file identifier sent to Miyo.
 *
 * Why: Miyo may be running on a different device than the vault on disk (e.g. a
 * laptop reading a server-hosted Miyo). The server-side absolute path on Miyo's
 * machine is unknown — and likely different — from the local Obsidian adapter's
 * absolute path. The folder name (== vault name) is the only device-independent
 * identifier, and Miyo's `resolveFileInput` remaps `<FolderName>/relative/path`
 * to the matching registered folder's canonical absolute path on the server.
 *
 * @param app - Obsidian application instance.
 * @param vaultRelativePath - Vault-relative note path (e.g. "Notes/foo.md").
 * @returns `<FolderName>/<vaultRelativePath>` with forward slashes.
 */
export function getMiyoFilePath(app: App, vaultRelativePath: string): string {
  const normalized = normalizeFilesystemPath(vaultRelativePath).replace(/^\/+/, "");
  const folderName = getMiyoFolderName(app);
  if (!folderName) {
    return normalized;
  }
  return `${folderName}/${normalized}`;
}

/**
 * Convert a Miyo file path to a vault-relative path when it belongs to the current vault.
 *
 * Miyo always returns paths prefixed with their owning folder name. When the
 * prefix matches the current vault's folder name, strip it to get a
 * vault-relative path. Files from other vaults pass through unchanged. The
 * returned path is always normalized to forward slashes.
 *
 * @param app - Obsidian application instance.
 * @param miyoPath - Path returned by Miyo (e.g., "MyVault/notes/foo.md").
 * @returns Normalized vault-relative path when inside the current vault, otherwise the normalized original path.
 */
export function getVaultRelativeMiyoPath(app: App, miyoPath: string): string {
  const normalizedMiyoPath = normalizeFilesystemPath(miyoPath);
  const folderName = getMiyoFolderName(app);
  if (!folderName) {
    return normalizedMiyoPath;
  }

  const folderPrefix = `${folderName}/`;
  if (normalizedMiyoPath.startsWith(folderPrefix)) {
    return normalizedMiyoPath.slice(folderPrefix.length);
  }

  return normalizedMiyoPath;
}

/**
 * Whether a RAW Miyo result path belongs to the current vault's registered
 * folder. Ownership must be decided before {@link getVaultRelativeMiyoPath}
 * strips the prefix: raw paths are unambiguous (this vault's results carry the
 * vault's folder name, other folders carry theirs), but once stripped, an
 * external folder that happens to share a name with a vault-relative folder
 * (e.g. a Miyo folder literally named "copilot") becomes indistinguishable
 * from in-vault content.
 *
 * @param app - Obsidian application instance.
 * @param miyoPath - Raw path as returned by Miyo, before prefix-stripping.
 */
export function isCurrentVaultMiyoPath(app: App, miyoPath: string): boolean {
  const folderName = getMiyoFolderName(app);
  if (!folderName) {
    // No resolvable folder name (mobile/remote): claim ownership so the
    // privacy filters still apply — the conservative direction.
    return true;
  }
  return normalizeFilesystemPath(miyoPath).startsWith(`${folderName}/`);
}

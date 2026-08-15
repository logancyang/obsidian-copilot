import type { MiyoAddFolderRequest } from "@/miyo/MiyoClient";
import {
  getMiyoStatusSnapshot,
  isMiyoAvailableForCapability,
  refreshMiyoStatus,
} from "@/miyo/miyoStatusStore";
import { getMiyoCustomUrl, shouldUseMiyo } from "@/miyo/miyoRuntimePolicy";
import {
  categorizePatterns,
  getDecodedPatterns,
  getSystemExcludedFolders,
} from "@/search/searchUtils";
import { CopilotSettings, getSettings } from "@/settings/model";
import { getDeviceId } from "@/utils/deviceId";
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
 * Frozen empty exclusions so an unfiltered vault never allocates a fresh object
 * (referential-stability rule).
 */
const EMPTY_MIYO_FOLDER_EXCLUSIONS: MiyoFolderExclusions = Object.freeze({});

/** Frozen empty ignore-folder list — referential stability for the default arg. */
const EMPTY_IGNORE_FOLDERS: readonly string[] = Object.freeze([]);

/** The exclude-only subset of {@link MiyoAddFolderRequest} we derive from settings. */
type MiyoFolderExclusions = Pick<MiyoAddFolderRequest, "exclude_folders" | "exclude_patterns">;

/**
 * Translate Copilot's `qaExclusions` into Miyo folder-registration excludes.
 *
 * `qaExclusions` is a comma-encoded mix of `#tags`, `*.ext`, `[[notes]]` and
 * folder paths. Miyo's folder API only models folder- and glob-based excludes,
 * so we translate the two that map cleanly and drop the rest rather than
 * approximate them:
 * - folder paths → `exclude_folders` (literal subfolders, relative to root)
 * - `*.ext`      → `exclude_patterns` globs prefixed with a recursive wildcard
 *
 * Tag- and note-scoped exclusions have no Miyo equivalent; Miyo will still index
 * those files, and Copilot's own filters continue to hide them from its own
 * results. Excludes always win in Miyo, so we bias the mapping toward
 * under-excluding (Miyo indexes a little extra) rather than over-excluding, which
 * would drop content from search.
 *
 * @param qaExclusions - The raw `qaExclusions` settings string.
 * @returns Exclude fields to merge into the add-folder request; frozen-empty
 *          when nothing maps.
 */
export function getMiyoFolderExclusions(
  qaExclusions: string,
  obsidianIgnoreFolders: readonly string[] = EMPTY_IGNORE_FOLDERS
): MiyoFolderExclusions {
  const { extensionPatterns, folderPatterns } = qaExclusions.trim()
    ? categorizePatterns(getDecodedPatterns(qaExclusions))
    : { extensionPatterns: [] as string[], folderPatterns: [] as string[] };

  // Mirror Copilot's own folder matcher exactly (matchFilePathWithFolders):
  // forward slashes, strip only a trailing slash. We deliberately DON'T strip a
  // leading "/" or "./" — those are dead patterns in Copilot (they never match a
  // vault-relative path), and "activating" them here would make Miyo over-exclude
  // folders Copilot still indexes (missing search results — the harmful direction).
  //
  // Drop entries that normalize to exactly "." or ".." (e.g. "./" → "."): Miyo
  // would read those as the vault root / its parent and exclude the ENTIRE vault
  // from indexing. "./foo" and friends stay — Copilot doesn't match them either,
  // so at worst they under-exclude, which is the safe direction.
  //
  // `obsidianIgnoreFolders` is Obsidian's own "Excluded files" (userIgnoreFilters):
  // literal folder/file paths the user hid at the vault level, so registration
  // honors them too — both exclude the same kind of thing. A userIgnoreFilters
  // regex ("/pattern/") reaches us with its trailing slash already stripped, so it
  // can't be told apart from a path and stays a literal "/pattern" Miyo won't match
  // — that under-excludes (the safe direction) rather than dropping intended files.
  const normalize = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const excludeFolders = [
    ...new Set(
      [...folderPatterns, ...obsidianIgnoreFolders]
        .map(normalize)
        .filter((pattern) => pattern.length > 0 && pattern !== "." && pattern !== "..")
    ),
  ];

  if (excludeFolders.length === 0 && extensionPatterns.length === 0) {
    return EMPTY_MIYO_FOLDER_EXCLUSIONS;
  }

  return {
    ...(excludeFolders.length > 0 ? { exclude_folders: excludeFolders } : {}),
    ...(extensionPatterns.length > 0
      ? { exclude_patterns: extensionPatterns.map((pattern) => `**/${pattern}`) }
      : {}),
  };
}

/** The include-only subset of {@link MiyoAddFolderRequest} we derive from settings. */
type MiyoFolderInclusions = Pick<
  MiyoAddFolderRequest,
  "include_folders" | "include_patterns" | "include_extensions"
>;

/** Frozen empty inclusions — no include filter (Miyo indexes everything). */
const EMPTY_MIYO_FOLDER_INCLUSIONS: MiyoFolderInclusions = Object.freeze({});

/**
 * Translate Copilot's `qaInclusions` into Miyo folder-registration includes.
 *
 * CRITICAL — the safe direction is the OPPOSITE of exclusions. Miyo's include
 * filter is a whitelist: per the folder API, if `include_folders` OR
 * `include_patterns` is non-empty, a file is in scope ONLY if it's under an
 * include folder or matches an include pattern. So dropping an un-mappable
 * inclusion (a `#tag` / `[[note]]` / `[key:value]`, which Miyo can't express)
 * while still sending the mappable ones would OVER-restrict — Miyo would index
 * only the folders we mapped and silently drop everything the un-mappable
 * inclusion was meant to keep. That is the harmful direction (missing search
 * results).
 *
 * So we send includes ONLY when `qaInclusions` maps CLEANLY AND COMPLETELY to
 * folder/extension terms (no tag, note, or property components). If any such
 * pattern is present, we send NO include filter at all — Miyo indexes the whole
 * vault and Copilot\'s own filters narrow results at query time. Under-indexing
 * never happens; at worst Miyo indexes a little extra, matching the exclusions bias.
 *
 * @param qaInclusions - The raw `qaInclusions` settings string.
 * @returns Include fields to merge into the add-folder request; frozen-empty when
 *          nothing maps or when a tag/note/property pattern forces the whole-vault
 *          fallback.
 */
export function getMiyoFolderInclusions(qaInclusions: string): MiyoFolderInclusions {
  if (!qaInclusions.trim()) {
    return EMPTY_MIYO_FOLDER_INCLUSIONS;
  }

  const { tagPatterns, notePatterns, propertyPatterns, extensionPatterns, folderPatterns } =
    categorizePatterns(getDecodedPatterns(qaInclusions));

  // Any tag/note/property inclusion → whitelist can\'t represent it → fall back to
  // no-filter (index everything) rather than over-restrict. A property matches on
  // frontmatter, which no folder/extension term can express.
  if (tagPatterns.length > 0 || notePatterns.length > 0 || propertyPatterns.length > 0) {
    return EMPTY_MIYO_FOLDER_INCLUSIONS;
  }

  // Same folder normalization as excludes. Drop entries that normalize to "." /
  // ".." — as an INCLUDE, "." would pin scope to the vault root but also read as
  // a degenerate whitelist entry; excluding it keeps the mapping to real
  // subfolders. "*.ext" → include_extensions (bare extension, no glob wildcard).
  const includeFolders = folderPatterns
    .map((pattern) => pattern.replace(/\\/g, "/").replace(/\/+$/, ""))
    .filter((pattern) => pattern.length > 0 && pattern !== "." && pattern !== "..");
  const includeExtensions = extensionPatterns.map((pattern) => pattern.replace(/^\*\./, ""));

  if (includeFolders.length === 0 && includeExtensions.length === 0) {
    return EMPTY_MIYO_FOLDER_INCLUSIONS;
  }

  return {
    ...(includeFolders.length > 0 ? { include_folders: includeFolders } : {}),
    ...(includeExtensions.length > 0 ? { include_extensions: includeExtensions } : {}),
  };
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

/**
 * Build the sync receipt recorded after the system root exclusions were
 * successfully pushed to the registered Miyo folder. The receipt self-identifies
 * its target — device, Miyo endpoint, folder name — alongside the sorted roots:
 *
 * - `device`: `data.json` syncs across devices but each device talks to its own
 *   Miyo, so a receipt written on device A must read as stale on device B.
 *   Embedding the device id makes that automatic without a device-local store.
 * - `url` / `folder`: switching the Miyo server or renaming the vault targets a
 *   different registration, which the old receipt must not vouch for.
 * - `roots` are sorted so an Obsidian Sync merge that reorders
 *   `copilotRootHistory` (content unchanged) cannot fake a mismatch and trigger
 *   a pointless destructive re-registration.
 *
 * @param app - Active Obsidian app; names the registered folder.
 * @param settings - Settings snapshot to derive the current scope from.
 */
export function buildMiyoSyncReceipt(app: App, settings: CopilotSettings): string {
  return JSON.stringify({
    device: getDeviceId(app),
    url: getMiyoCustomUrl(settings),
    folder: getMiyoFolderName(app),
    roots: [...getSystemExcludedFolders(settings)].sort(),
  });
}

/** Parsed shape of a stored sync receipt. */
export interface MiyoSyncReceipt {
  device: string;
  url: string;
  folder: string;
  roots: string[];
}

/**
 * Parse a stored sync receipt, or null when absent/malformed. Callers use the
 * identity fields to decide whether the receipt vouches for the registration
 * they are looking at (same device, endpoint, and folder name).
 *
 * DESIGN NOTE — a foreign receipt proves NOTHING about this device's Miyo.
 * `miyoSyncedExclusions` syncs via data.json, but each device talks to its own
 * Miyo server. After device B resyncs, its receipt arrives here with current
 * roots — yet THIS device's Miyo may still hold the old scope, and its Relay
 * can keep exposing new-root content. The receipt's `device` field makes that
 * detectable (mismatch → banner, and #4 keeps over-fetching conservatively),
 * but the startup roots-change notice deliberately stays quiet for
 * device-only mismatches to avoid nagging when this device's server is in
 * fact fine. The Miyo tab's on-load `verifyMiyoScope` is the self-heal entry
 * point — and the exposure window lasts until the user opens that tab.
 * An EMPTY receipt is the same shape of unknown: a registration made before
 * receipts existed leaves no local evidence, and a migration cannot
 * synthesize a truthful one (the server's scope is unknowable offline;
 * fabricating a receipt would falsely mark it synced). Empty stays the
 * conservative state — mismatch holds, the retriever over-fetches, the Miyo
 * tab's on-load verify self-heals or forces the banner, and the root-change
 * trigger runs a read-only live probe for the disconnected-with-empty-receipt
 * case. The startup roots-change notice still needs a parseable receipt:
 * noticing on every empty receipt would nag the entire pre-receipt user base
 * whose scopes are in fact fine.
 * Follow-up (out of scope here): a timeout-bounded startup live-verify for
 * foreign receipts. If a future review flags this again, point them here.
 *
 * @param stored - Raw `miyoSyncedExclusions` value.
 */
export function parseMiyoSyncReceipt(stored: unknown): MiyoSyncReceipt | null {
  if (typeof stored !== "string" || stored.length === 0) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<MiyoSyncReceipt>;
    if (
      typeof parsed.device !== "string" ||
      typeof parsed.url !== "string" ||
      typeof parsed.folder !== "string" ||
      !Array.isArray(parsed.roots)
    ) {
      return null;
    }
    return parsed as MiyoSyncReceipt;
  } catch {
    return null;
  }
}

/**
 * Whether the recorded sync receipt no longer matches the current expected
 * scope — i.e. Miyo's server-side exclusions may be stale. Errors and missing
 * fields read as mismatch: the consequences of a false positive are a benign
 * over-fetch and a verify-first resync, while a false negative leaks.
 */
export function isMiyoScopeMismatch(app: App, settings: CopilotSettings): boolean {
  try {
    const stored =
      typeof settings.miyoSyncedExclusions === "string" ? settings.miyoSyncedExclusions : "";
    return stored !== buildMiyoSyncReceipt(app, settings);
  } catch {
    return true;
  }
}

/**
 * Whether the resync prompt (banner / post-root-change notice) should surface.
 * Requires a mismatch plus evidence Miyo is in play: `enableMiyo`, or a
 * non-empty receipt proving a past registration — a user who disconnected in
 * Copilot but left Miyo + Relay running is still exposed and must not lose the
 * prompt.
 */
export function shouldSurfaceMiyoResync(app: App, settings: CopilotSettings): boolean {
  const stored =
    typeof settings.miyoSyncedExclusions === "string" ? settings.miyoSyncedExclusions : "";
  return isMiyoScopeMismatch(app, settings) && (settings.enableMiyo === true || stored !== "");
}

/**
 * Whether the system roots differ from those in the recorded receipt — the
 * signal for the one-time startup notice when a root change arrived via
 * settings sync without passing through the settings UI. A mismatch caused only
 * by another device's receipt (roots equal, device differs) stays silent; the
 * Miyo tab's on-load verification self-heals that case without nagging.
 */
export function didMiyoSyncedRootsChange(settings: CopilotSettings): boolean {
  const receipt = parseMiyoSyncReceipt(settings.miyoSyncedExclusions);
  if (!receipt) return false;
  const current = [...getSystemExcludedFolders(settings)].sort();
  return JSON.stringify(receipt.roots) !== JSON.stringify(current);
}

/**
 * Whether the user has QA patterns of their own — beyond the system root
 * exclusions — that the Miyo retriever's local filter can act on. Drives the
 * over-fetch decision: with no user patterns and a synced scope, the server
 * already omits everything the local filter would drop.
 *
 * `qaExclusions` defaults to the Copilot root, so raw non-emptiness is not a
 * signal; system-root entries are subtracted before judging.
 */
export function hasUserQaPatterns(settings: CopilotSettings): boolean {
  if ((settings.qaInclusions || "").trim().length > 0) return true;
  const raw = (settings.qaExclusions || "").trim();
  if (raw.length === 0) return false;
  const system = new Set(getSystemExcludedFolders(settings));
  return getDecodedPatterns(raw).some((pattern) => !system.has(pattern.replace(/\/+$/, "")));
}

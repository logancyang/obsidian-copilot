import { logInfo, logWarn } from "@/logger";
import { MiyoClient, type MiyoAddFolderRequest, type MiyoFolderEntry } from "@/miyo/MiyoClient";
import {
  buildMiyoSyncReceipt,
  getMiyoCustomUrl,
  getMiyoFolderExclusions,
  getMiyoFolderInclusions,
  getMiyoFolderName,
  parseMiyoSyncReceipt,
  type MiyoSyncReceipt,
} from "@/miyo/miyoUtils";
import { extractAppIgnoreSettings, getSystemExcludedFolders } from "@/search/searchUtils";
import { type CopilotSettings, getSettings, updateSetting } from "@/settings/model";
import { err2String } from "@/utils";
import { getDeviceId } from "@/utils/deviceId";
import { getVaultBase } from "@/utils/vaultPath";
import type { App } from "obsidian";

/**
 * Resynchronize the vault's Miyo registration with the current Copilot scope.
 *
 * Miyo only receives exclusions as a registration-time snapshot, so a Copilot
 * root change leaves the server indexing content that should be excluded (and
 * readable via Relay). This module owns the reconcile: verify the live record,
 * and only when it genuinely diverges, delete + re-register with the fresh
 * scope (deletion also purges the folder's index, verified empirically).
 *
 * All Miyo folder mutations — resync runs AND the register flow — must pass
 * through {@link enqueueMiyoFolderMutation} so a resync can never interleave
 * its DELETE/POST with a concurrent registration.
 */

/** Result of one resync run, for the caller to map onto user-facing messages. */
export type MiyoResyncOutcome =
  /** Server record already covered the scope; receipt written, nothing rebuilt. */
  | "verified"
  /** Deleted + re-registered with the fresh scope; re-scan kicked off. */
  | "resynced"
  /** Re-registered, but the re-scan trigger failed; Miyo re-scans on its own. */
  | "resynced-scan-failed"
  /** Re-add hit 409 right after a delete — server state contested; still stale. */
  | "conflict"
  /** Transport/setup failure (Miyo unreachable, no vault base, …); still stale. */
  | "failed";

// Serializes every Miyo folder mutation. Reason: the auto-resync after a root
// change, the settings-tab Resync button, and the register flow can otherwise
// interleave DELETE/POST against the same registration. The chain mirrors the
// agent-skills seedChain: each task reads fresh state when IT runs (so a root
// change mid-run simply enqueues a later run that sees the newer root), and the
// chain itself never rejects so one failure can't strand later mutations.
let mutationChain: Promise<unknown> = Promise.resolve();

/**
 * Run `task` behind every previously enqueued Miyo folder mutation. Returns the
 * task's own promise (rejections reach the caller; the chain stays resolved).
 *
 * @param task - Mutation to serialize; invoked once its turn arrives.
 */
export function enqueueMiyoFolderMutation<T>(task: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(task);
  mutationChain = run.catch(() => {
    /* keep the chain alive for the next mutation */
  });
  return run;
}

/** How long a read-only Miyo lookup may hold the mutation chain. */
const LOOKUP_TIMEOUT_MS = 10_000;

/**
 * Bound a READ-ONLY lookup so a Miyo that accepts the connection but never
 * responds can't hold the mutation chain forever (Obsidian's `requestUrl` has
 * no timeout of its own — see `fetchHealth`'s probe timeout for the precedent).
 *
 * DESIGN NOTE — mutations (DELETE/POST/scan) are deliberately NOT wrapped.
 * `requestUrl` is uncancellable: racing a mutation against a timer would let
 * the chain advance while the request may still land later, which is exactly
 * the interleaving the chain exists to prevent. A hung mutation therefore still
 * blocks the queue; the read-only bound covers the common mount-verify path.
 * If a future review flags this again, point them here.
 */
function withLookupTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`Miyo ${label} timed out after ${LOOKUP_TIMEOUT_MS}ms`)),
      LOOKUP_TIMEOUT_MS
    );
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

/**
 * Whether the stored receipt vouches for the registration currently being
 * queried — same device, same Miyo endpoint, same folder name. Only then may a
 * 404 be read as "our registration is gone"; a foreign or renamed identity says
 * nothing about the record the receipt actually describes.
 */
function receiptMatchesIdentity(
  receipt: MiyoSyncReceipt,
  settings: { miyoServerUrl?: string },
  folderName: string
): boolean {
  return (
    receipt.device === getDeviceId() &&
    receipt.url === (settings.miyoServerUrl || "").trim() &&
    receipt.folder === folderName
  );
}

/** String-array field of a folder record, read defensively (loose entry type). */
function recordArray(record: MiyoFolderEntry, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function isSuperset(container: readonly string[], required: readonly string[]): boolean {
  const set = new Set(container);
  return required.every((entry) => set.has(entry));
}

/**
 * Whether the live folder record already excludes every CURRENT system root
 * (active + historical Copilot roots), making a destructive delete +
 * re-register (and the full re-index it implies) unnecessary.
 *
 * DESIGN NOTE — the staleness signal is deliberately ROOTS-ONLY. Drift in the
 * qa* patterns or Obsidian's own ignore list is the pre-existing
 * registration-snapshot gap documented at the registration site (qa* scope is
 * re-applied live at query time; the ignore-list gap predates this PR), and
 * comparing the full desired body here would flag — and destructively
 * rebuild for — users who never changed their root. Only the resync BODY uses
 * the full current scope, so once a roots-driven rebuild does happen it
 * carries everything current along. Exclusions may be a superset: extra,
 * user-added Miyo-side exclusions are privacy-safe and not ours to fight,
 * while the leak direction (a system root MISSING from the server's
 * exclusions) always fails the superset and triggers the rebuild.
 * If a future review flags this again, point them here.
 *
 * @param record - Live folder entry fetched from Miyo.
 * @param settings - Settings snapshot the current system roots derive from.
 */
export function miyoRecordCoversSystemRoots(
  record: MiyoFolderEntry,
  settings: CopilotSettings
): boolean {
  // Reuse the registration-body builder (with no qa patterns) so the roots are
  // normalized exactly as they were when pushed into `exclude_folders`.
  const desired = getMiyoFolderExclusions("", getSystemExcludedFolders(settings));
  return isSuperset(recordArray(record, "exclude_folders"), desired.exclude_folders ?? []);
}

/** Registration body for the current scope (shared by resync and verify). */
function buildDesiredScope(app: App, settings = getSettings()): MiyoAddFolderRequest {
  return {
    path: getVaultBase(app) ?? "",
    ...getMiyoFolderInclusions(settings.qaInclusions),
    ...getMiyoFolderExclusions(settings.qaExclusions, [
      ...getSystemExcludedFolders(settings),
      ...extractAppIgnoreSettings(app),
    ]),
  };
}

/**
 * Resync the vault's Miyo registration to the current scope. Never throws —
 * every failure maps to an outcome so fire-and-forget callers stay safe.
 *
 * Serialized via {@link enqueueMiyoFolderMutation}; reads settings fresh when
 * its turn arrives, so a queued run always reconciles toward the latest scope.
 *
 * @param app - Active Obsidian app (vault name/base for the registration).
 */
export function resyncMiyoFolder(app: App): Promise<MiyoResyncOutcome> {
  return enqueueMiyoFolderMutation(() => runResync(app));
}

/** Result of a read-only scope verification against the live Miyo record. */
export type MiyoScopeVerification = "covered" | "stale" | "unregistered" | "unknown";

/**
 * Verify the live Miyo record against the current scope WITHOUT rebuilding,
 * self-healing the local receipt where the server is the better witness:
 *
 * - record covers the scope but the local receipt mismatches (another device's
 *   receipt arrived via sync, a sync merge reordered history, …) → write the
 *   current receipt silently; no banner, no destructive rebuild.
 * - vault not registered AND the stored receipt names exactly this
 *   device/endpoint/folder → the registration it vouched for is truly gone
 *   (user removed it in Miyo); clear the receipt. A 404 with a DIFFERENT
 *   receipt identity proves nothing about the record the receipt describes:
 *   a renamed vault (same device+endpoint, old folder name) reports "stale" so
 *   the old registration gets surfaced and cleaned up; a foreign-device or
 *   other-endpoint receipt is left untouched and reads "unregistered" (nothing
 *   is exposed on THIS server).
 * - record does NOT cover the scope → "stale": the caller must surface the
 *   resync prompt even if local state looks clean (Reset Settings wiped the
 *   receipt, or the user registered before receipts existed) — the live record
 *   outranks local signals in both directions.
 *
 * Never throws; unreachable Miyo reports "unknown" so callers fall back to the
 * local mismatch signal.
 *
 * @param app - Active Obsidian app (vault name for the registration lookup).
 */
export function verifyMiyoScope(app: App): Promise<MiyoScopeVerification> {
  return enqueueMiyoFolderMutation(() => runVerify(app));
}

async function runVerify(app: App): Promise<MiyoScopeVerification> {
  try {
    const settings = getSettings();
    const folderName = getMiyoFolderName(app);
    const customUrl = getMiyoCustomUrl(settings) || undefined;
    const client = new MiyoClient();
    const baseUrl = await client.resolveBaseUrl(customUrl);

    let record: MiyoFolderEntry;
    try {
      record = await withLookupTimeout(client.getFolder(baseUrl, folderName), "folder lookup");
    } catch {
      const registration = await withLookupTimeout(
        client.checkFolderRegistration(folderName, customUrl),
        "registration check"
      );
      if (registration !== "unregistered") {
        return "unknown";
      }
      const receipt = parseMiyoSyncReceipt(settings.miyoSyncedExclusions);
      if (!receipt) {
        // Empty — nothing to clear — or non-empty but unparseable. The latter
        // cannot be attributed to any identity, so it is never cleared: wiping
        // it would sync out and destroy whatever evidence it holds elsewhere.
        return "unregistered";
      }
      if (receiptMatchesIdentity(receipt, settings, folderName)) {
        updateSetting("miyoSyncedExclusions", "");
        return "unregistered";
      }
      // Same device + endpoint but a different folder name: the vault was
      // renamed and the OLD registration may still exist (and expose content).
      // Keep the receipt as the cleanup lead and surface the prompt.
      if (receipt.device === getDeviceId() && receipt.url === getMiyoCustomUrl(settings)) {
        return "stale";
      }
      // Foreign device / other endpoint: says nothing about this server, and
      // clearing it would clobber the other device's evidence via sync.
      return "unregistered";
    }

    if (!miyoRecordCoversSystemRoots(record, settings)) {
      return "stale";
    }
    const receipt = buildMiyoSyncReceipt(app, settings);
    if (settings.miyoSyncedExclusions !== receipt) {
      updateSetting("miyoSyncedExclusions", receipt);
    }
    return "covered";
  } catch (error) {
    logWarn(`Miyo scope verification failed: ${err2String(error)}`);
    return "unknown";
  }
}

async function runResync(app: App): Promise<MiyoResyncOutcome> {
  try {
    const settings = getSettings();
    const vaultBase = getVaultBase(app);
    if (!vaultBase) {
      logWarn("Miyo resync: no vault base path (mobile/remote?); cannot resync.");
      return "failed";
    }
    const folderName = getMiyoFolderName(app);
    const customUrl = getMiyoCustomUrl(settings) || undefined;
    const client = new MiyoClient();
    const baseUrl = await client.resolveBaseUrl(customUrl);

    // Capture the receipt for the scope we are about to commit. Written only
    // after that exact commit succeeds — never recomputed afterwards, so a root
    // change landing mid-run can't get marked as synced by this run (its own
    // queued run will reconcile it).
    const receipt = buildMiyoSyncReceipt(app, settings);
    const desired = buildDesiredScope(app, settings);

    // Verify first: a record that already enforces the scope needs no rebuild.
    let record: MiyoFolderEntry | null = null;
    try {
      record = await withLookupTimeout(client.getFolder(baseUrl, folderName), "folder lookup");
    } catch (error) {
      const registration = await withLookupTimeout(
        client.checkFolderRegistration(folderName, customUrl),
        "registration check"
      );
      if (registration !== "unregistered") {
        logWarn(`Miyo resync: could not read folder record: ${err2String(error)}`);
        return "failed";
      }
      // Unregistered: recovery path — a prior run deleted but never re-added
      // (or the user removed it in Miyo). Register directly with the fresh scope.
      // If the receipt shows THIS device+endpoint registered under a different
      // folder name, the vault was renamed and the old registration still
      // exists — delete it so it can't keep serving stale content. Never act on
      // a foreign-device or other-endpoint receipt: it is not ours to delete.
      const staleReceipt = parseMiyoSyncReceipt(settings.miyoSyncedExclusions);
      if (
        staleReceipt &&
        staleReceipt.device === getDeviceId() &&
        staleReceipt.url === getMiyoCustomUrl(settings) &&
        staleReceipt.folder !== folderName
      ) {
        await client.deleteFolder(staleReceipt.folder, customUrl);
      }
    }

    if (record) {
      if (miyoRecordCoversSystemRoots(record, settings)) {
        updateSetting("miyoSyncedExclusions", receipt);
        logInfo("Miyo resync: server record already covers the scope; receipt updated.");
        return "verified";
      }
      // Carry the user's Miyo-side toggles into the re-registration. Fail
      // closed when a field is absent: omitting allow_remote_read makes the
      // server default it to TRUE, silently re-enabling Relay for a user who
      // opted out in Miyo — the exact privacy hole this resync exists to close.
      desired.allow_remote_read = record.allow_remote_read === true;
      desired.allow_writes = record.allow_writes === true;

      await client.deleteFolder(folderName, customUrl);
    } else {
      // Fresh registration (recovery): match the register flow's defaults.
      desired.allow_remote_read = true;
    }

    const created = await client.addFolder(desired, customUrl);
    if (created === null) {
      // 409 right after a delete (or on the recovery path): the server still
      // holds a registration we couldn't replace. Do NOT write the receipt —
      // its exclusions are unknown and possibly stale.
      logWarn("Miyo resync: re-add returned 409; server registration contested.");
      return "conflict";
    }

    updateSetting("miyoSyncedExclusions", receipt);

    try {
      await client.scanFolder(baseUrl, folderName, false);
      return "resynced";
    } catch (error) {
      // The scope is committed and the receipt is correct; only the re-index
      // kick failed. Miyo re-scans registered folders on its own (verified on a
      // live instance: last_scan advances days after registration), so surface
      // a warning instead of staying dirty — staying dirty would provoke
      // another destructive delete/re-add for a self-healing lag.
      logWarn(`Miyo resync: re-scan trigger failed: ${err2String(error)}`);
      return "resynced-scan-failed";
    }
  } catch (error) {
    logWarn(`Miyo resync failed: ${err2String(error)}`);
    return "failed";
  }
}

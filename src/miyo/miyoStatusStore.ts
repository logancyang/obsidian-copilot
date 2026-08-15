import { logWarn } from "@/logger";
import { MiyoClient } from "@/miyo/MiyoClient";
import type { MiyoHealthResponse } from "@/miyo/miyoHealth";
import { getMiyoCustomUrl, shouldUseMiyo } from "@/miyo/miyoRuntimePolicy";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { err2String } from "@/utils";

/**
 * Runtime status of one Miyo capability.
 *
 * - `available`   — reachable and reporting healthy.
 * - `unavailable` — reached Miyo, but this capability is off / not set up.
 * - `unknown`     — never probed, disabled, or Miyo didn't report this block.
 * - `stale`       — was available, but the snapshot has aged past the stale horizon.
 * - `syncing`     — chat-sync is actively indexing.
 *
 * Per-capability truth: a missing `relay`/`chat_sync` block degrades only that
 * capability to `unknown`, never the whole snapshot.
 */
export type CapabilityStatus = "available" | "unavailable" | "unknown" | "stale" | "syncing";

/** The four Miyo capabilities the settings UI and doc-processor fallback read. */
export type MiyoCapability = "backend" | "connector" | "chatSync" | "documentProcessor";

/**
 * Immutable snapshot of Miyo runtime status. Every read returns a referentially
 * stable object (frozen, memoized) so it can back `useSyncExternalStore` without
 * tearing.
 */
export interface MiyoStatusSnapshot {
  backend: CapabilityStatus;
  connector: CapabilityStatus;
  chatSync: CapabilityStatus;
  documentProcessor: CapabilityStatus;
  /** Epoch ms of the last successful fetch, or null when never fetched. */
  checkedAt: number | null;
  source: "cache" | "fresh" | "none";
}

/** Below this age a snapshot is fresh; `refreshMiyoStatus` serves cache instead of fetching. */
const MIYO_STATUS_TTL_MS = 10_000;

/** Past this age an `available` capability reads as `stale` until the next refresh. */
const MIYO_STATUS_STALE_MS = 60_000;

/**
 * The "never probed" snapshot. Frozen and shared so pre-fetch reads are
 * referentially stable and cheap to compare.
 */
const EMPTY_MIYO_STATUS_SNAPSHOT: MiyoStatusSnapshot = Object.freeze({
  backend: "unknown",
  connector: "unknown",
  chatSync: "unknown",
  documentProcessor: "unknown",
  checkedAt: null,
  source: "none",
});

const miyoClient = new MiyoClient();
const listeners = new Set<() => void>();

/** Latest fetched snapshot (or EMPTY). Never mutated in place — replaced wholesale. */
let currentSnapshot: MiyoStatusSnapshot = EMPTY_MIYO_STATUS_SNAPSHOT;

/** Shared in-flight refresh, so concurrent callers dedupe onto one network round-trip. */
let inFlightRefresh: Promise<MiyoStatusSnapshot> | null = null;

// Whether the settings-change subscription has been registered. Deferred to the
// first refresh (not module load) so importing this module has no side effect —
// otherwise the import chain would call subscribeToSettingsChange during test
// setup, before any settings mock provides it.
let settingsSubscribed = false;

// Bumped on every snapshot replacement (fetch result, reset, invalidate). A
// refresh captures the generation before its network call and discards its
// result if the generation moved on — so an invalidation (config change /
// disconnect) that lands mid-flight can't be overwritten by the stale response
// it raced.
let generation = 0;

// Memoize the stale-downgraded view so repeated getSnapshot() calls past the
// stale horizon keep returning the same object identity (required by
// useSyncExternalStore). Invalidated whenever currentSnapshot changes.
let staleViewBase: MiyoStatusSnapshot | null = null;
let staleView: MiyoStatusSnapshot | null = null;

/**
 * Read the current Miyo status snapshot synchronously. Never throws, never
 * fetches. Applies stale-downgrade on read so a snapshot that aged out reports
 * `stale` for its previously-`available` capabilities.
 *
 * DESIGN NOTE (intentional — do NOT add a horizon timer/notify): the
 * available→stale transition happens lazily on READ at the `MIYO_STATUS_STALE_MS`
 * horizon; the store does NOT schedule a timer to emit at that moment, so a
 * settings page held open past the horizon keeps showing the last snapshot until
 * some unrelated re-render calls this getter. This is deliberate, not a missed
 * notification:
 *   - Consumers treat `stale` as "still connected" (see MiyoSettings'
 *     `capabilitiesEnabled`), specifically to avoid the UI flapping to
 *     "disconnected" the instant a snapshot ages out.
 *   - Runtime routing never uses this gate — it calls
 *     `isMiyoAvailableForCapability` (strict `=== "available"`), so a stale read
 *     can't misroute anything; a real disconnect is caught by the next probe.
 * Adding a horizon timer would fight the first point and buy only a cosmetic pill
 * refresh. If a future review flags this again, point them at this note.
 */
export function getMiyoStatusSnapshot(): MiyoStatusSnapshot {
  if (currentSnapshot.checkedAt === null) {
    return currentSnapshot;
  }
  if (Date.now() - currentSnapshot.checkedAt <= MIYO_STATUS_STALE_MS) {
    return currentSnapshot;
  }
  if (staleViewBase === currentSnapshot && staleView) {
    return staleView;
  }
  staleViewBase = currentSnapshot;
  staleView = Object.freeze({
    ...currentSnapshot,
    backend: downgradeStale(currentSnapshot.backend),
    connector: downgradeStale(currentSnapshot.connector),
    chatSync: downgradeStale(currentSnapshot.chatSync),
    documentProcessor: downgradeStale(currentSnapshot.documentProcessor),
  });
  return staleView;
}

/**
 * Whether a capability is available right now. Hard gate: only `available`
 * counts — `stale`/`syncing`/`unknown`/`unavailable` all read as false. Callers
 * (e.g. the doc-processor fallback) can rely on this alone; when Miyo is
 * disabled the snapshot is all-`unknown`, so every capability returns false.
 */
export function isMiyoAvailableForCapability(cap: MiyoCapability): boolean {
  return getMiyoStatusSnapshot()[cap] === "available";
}

/**
 * Refresh Miyo status on demand. Single-flight (concurrent callers share one
 * fetch) and TTL-gated (a fresh snapshot short-circuits without a network call
 * unless `force` is set). Never polls; the caller decides when to check.
 *
 * When Miyo is disabled (`shouldUseMiyo` false), this resets to the empty
 * snapshot and returns without any network request — runtime availability of a
 * disabled backend is definitionally "unknown".
 *
 * @param options.force - Bypass the TTL and always fetch.
 */
export function refreshMiyoStatus(options: { force?: boolean } = {}): Promise<MiyoStatusSnapshot> {
  ensureSettingsSubscription();

  if (!shouldUseMiyo(getSettings())) {
    // Disabled: reset to empty and cancel any in-flight fetch so a late response
    // can't flip a disabled backend back to available.
    invalidateMiyoStatus();
    return Promise.resolve(currentSnapshot);
  }

  if (!options.force && isSnapshotFresh()) {
    return Promise.resolve(currentSnapshot);
  }

  if (inFlightRefresh) {
    return inFlightRefresh;
  }

  const refresh = fetchAndApply().finally(() => {
    // Only clear if this is still the current in-flight promise: an invalidation
    // mid-flight nulls inFlightRefresh and a newer refresh may have replaced it,
    // and that newer one must not be clobbered when this (abandoned) one settles.
    if (inFlightRefresh === refresh) {
      inFlightRefresh = null;
    }
  });
  inFlightRefresh = refresh;
  return refresh;
}

/**
 * Drop the cached snapshot and notify subscribers. Called on config change
 * (server URL / enable toggle) and on explicit disconnect, so stale reachability
 * never lingers after the endpoint changes.
 */
export function invalidateMiyoStatus(): void {
  // Always advance the generation, even when the snapshot is already empty: an
  // in-flight fetch started before this call must be cancelled so its (now
  // stale-endpoint) result can't land after the invalidation.
  generation += 1;
  // Clear the in-flight handle so the next refresh starts a fresh fetch against
  // the new endpoint instead of dedup'ing onto the now-stale request (whose
  // result is discarded by the generation guard anyway, which would otherwise
  // leave the new endpoint never probed).
  inFlightRefresh = null;
  if (currentSnapshot !== EMPTY_MIYO_STATUS_SNAPSHOT) {
    currentSnapshot = EMPTY_MIYO_STATUS_SNAPSHOT;
    staleViewBase = null;
    staleView = null;
    listeners.forEach((listener) => listener());
  }
}

/**
 * Subscribe to snapshot changes. Returns an unsubscribe function. Designed for
 * `useSyncExternalStore(subscribeMiyoStatus, getMiyoStatusSnapshot)`.
 */
export function subscribeMiyoStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Register the settings-change subscription once, on first use. Config changes
 * to the Miyo endpoint or enable toggle invalidate the cache: the previous
 * reachability result no longer describes the new target.
 */
function ensureSettingsSubscription(): void {
  if (settingsSubscribed) {
    return;
  }
  settingsSubscribed = true;
  subscribeToSettingsChange((prev, next) => {
    if (prev.enableMiyo !== next.enableMiyo || getMiyoCustomUrl(prev) !== getMiyoCustomUrl(next)) {
      invalidateMiyoStatus();
    }
  });
}

/** Fetch health and fold it into a new current snapshot; never rejects. */
async function fetchAndApply(): Promise<MiyoStatusSnapshot> {
  const startedGeneration = generation;
  const overrideUrl = getMiyoCustomUrl(getSettings()) || undefined;
  let health: MiyoHealthResponse | null = null;
  try {
    health = await miyoClient.fetchHealth(overrideUrl);
  } catch (error) {
    // fetchHealth already swallows its own errors; this guards any future throw.
    logWarn(`Miyo status refresh failed: ${err2String(error)}`);
    health = null;
  }
  // Drop the result if the store was invalidated (config change / disconnect)
  // while this fetch was in flight — applying it would resurrect status for a
  // now-stale endpoint.
  if (generation !== startedGeneration) {
    return currentSnapshot;
  }
  setSnapshot(snapshotFromHealth(health, Date.now()));
  return currentSnapshot;
}

/**
 * Map a health payload (or its absence) to a full snapshot. Each capability is
 * derived independently so a missing sub-block degrades only itself.
 */
function snapshotFromHealth(
  health: MiyoHealthResponse | null,
  checkedAt: number
): MiyoStatusSnapshot {
  // Couldn't reach Miyo, or it didn't report healthy: backend is unavailable,
  // but the other capabilities are indeterminate (not "off") — no signal for
  // them. Gating on status === "ok" keeps this consistent with
  // MiyoClient.isBackendAvailable, so a `{status:"error"}` payload never reads
  // as connected.
  if (!health || health.status !== "ok") {
    return Object.freeze({
      backend: "unavailable",
      connector: "unknown",
      chatSync: "unknown",
      documentProcessor: "unknown",
      checkedAt,
      source: "fresh",
    });
  }

  return Object.freeze({
    backend: "available",
    connector: mapConnector(health.relay),
    chatSync: mapChatSync(health.chat_sync),
    documentProcessor: "available",
    checkedAt,
    source: "fresh",
  });
}

/**
 * relay absent, or present but reporting `status: "unknown"`/no status → unknown
 * (the Electron app hasn't pushed relay state yet — an indeterminate startup
 * window we must not render as a hard "disconnected"); `connected` → available;
 * any other concrete status (e.g. `disconnected`) → unavailable.
 */
function mapConnector(relay: MiyoHealthResponse["relay"]): CapabilityStatus {
  if (!relay || !relay.status || relay.status === "unknown") {
    return "unknown";
  }
  return relay.status === "connected" ? "available" : "unavailable";
}

/**
 * chat_sync absent → unknown; any platform syncing → syncing; configured →
 * available; otherwise unavailable. `active` tracks syncing/connecting work,
 * so it is normally false once chat history is ready.
 */
function mapChatSync(chatSync: MiyoHealthResponse["chat_sync"]): CapabilityStatus {
  if (!chatSync) {
    return "unknown";
  }
  if (hasSyncingPlatform(chatSync.platforms)) {
    return "syncing";
  }
  return chatSync.configured === true ? "available" : "unavailable";
}

function hasSyncingPlatform(
  platforms: NonNullable<MiyoHealthResponse["chat_sync"]>["platforms"]
): boolean {
  if (!platforms) {
    return false;
  }
  return Object.values(platforms).some((platform) => platform?.syncing === true);
}

function isSnapshotFresh(): boolean {
  return (
    currentSnapshot.checkedAt !== null &&
    Date.now() - currentSnapshot.checkedAt <= MIYO_STATUS_TTL_MS
  );
}

function downgradeStale(status: CapabilityStatus): CapabilityStatus {
  return status === "available" ? "stale" : status;
}

function setSnapshot(next: MiyoStatusSnapshot): void {
  currentSnapshot = next;
  generation += 1;
  staleViewBase = null;
  staleView = null;
  listeners.forEach((listener) => listener());
}

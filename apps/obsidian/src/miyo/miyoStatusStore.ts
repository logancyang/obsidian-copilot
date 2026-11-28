import { logWarn } from "@/logger";
import { MiyoClient } from "@/miyo/MiyoClient";
import type { MiyoHealthResponse } from "@/miyo/miyoHealth";
import { getMiyoCustomUrl, shouldUseMiyo } from "@/miyo/miyoRuntimePolicy";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { err2String } from "@/utils";

export type CapabilityStatus = "available" | "unavailable" | "unknown" | "stale" | "syncing";

export type MiyoCapability = "backend" | "connector" | "chatSync" | "documentProcessor";

export interface MiyoStatusSnapshot {
  backend: CapabilityStatus;
  connector: CapabilityStatus;
  chatSync: CapabilityStatus;
  documentProcessor: CapabilityStatus;
  checkedAt: number | null;
  source: "cache" | "fresh" | "none";
}

const MIYO_STATUS_TTL_MS = 10_000;

const MIYO_STATUS_STALE_MS = 60_000;

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

let currentSnapshot: MiyoStatusSnapshot = EMPTY_MIYO_STATUS_SNAPSHOT;

let inFlightRefresh: Promise<MiyoStatusSnapshot> | null = null;

let settingsSubscribed = false;

let generation = 0;

let staleViewBase: MiyoStatusSnapshot | null = null;
let staleView: MiyoStatusSnapshot | null = null;

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

export function isMiyoAvailableForCapability(cap: MiyoCapability): boolean {
  return getMiyoStatusSnapshot()[cap] === "available";
}

export function refreshMiyoStatus(options: { force?: boolean } = {}): Promise<MiyoStatusSnapshot> {
  ensureSettingsSubscription();

  if (!shouldUseMiyo(getSettings())) {
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
    if (inFlightRefresh === refresh) {
      inFlightRefresh = null;
    }
  });
  inFlightRefresh = refresh;
  return refresh;
}

export function invalidateMiyoStatus(): void {
  generation += 1;
  inFlightRefresh = null;
  if (currentSnapshot !== EMPTY_MIYO_STATUS_SNAPSHOT) {
    currentSnapshot = EMPTY_MIYO_STATUS_SNAPSHOT;
    staleViewBase = null;
    staleView = null;
    listeners.forEach((listener) => listener());
  }
}

export function subscribeMiyoStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

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

async function fetchAndApply(): Promise<MiyoStatusSnapshot> {
  const startedGeneration = generation;
  const overrideUrl = getMiyoCustomUrl(getSettings()) || undefined;
  let health: MiyoHealthResponse | null = null;
  try {
    health = await miyoClient.fetchHealth(overrideUrl);
  } catch (error) {
    logWarn(`Miyo status refresh failed: ${err2String(error)}`);
    health = null;
  }
  if (generation !== startedGeneration) {
    return currentSnapshot;
  }
  setSnapshot(snapshotFromHealth(health, Date.now()));
  return currentSnapshot;
}

function snapshotFromHealth(
  health: MiyoHealthResponse | null,
  checkedAt: number
): MiyoStatusSnapshot {
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

function mapConnector(relay: MiyoHealthResponse["relay"]): CapabilityStatus {
  if (!relay || !relay.status || relay.status === "unknown") {
    return "unknown";
  }
  return relay.status === "connected" ? "available" : "unavailable";
}

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

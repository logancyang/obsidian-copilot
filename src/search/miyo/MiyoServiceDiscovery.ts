import { readFile } from "fs/promises";
import os from "os";
import path from "path";
import { logInfo, logWarn } from "@/logger";

/**
 * Shape of the Miyo service.json file.
 */
export interface MiyoServiceInfo {
  version: number;
  host: string;
  port: number;
  pid?: number;
  started_at?: string;
}

/**
 * Result of a successful Miyo service discovery.
 */
export interface MiyoDiscoveryResult {
  baseUrl: string;
  info: MiyoServiceInfo;
}

const SERVICE_RELATIVE_PATH = path.join("Library", "Application Support", "Miyo", "service.json");
const DISCOVERY_CACHE_TTL_MS = 5_000;

let cachedDiscovery: { value: MiyoDiscoveryResult; expiresAt: number } | null = null;

/**
 * Build the absolute path to Miyo's service.json.
 */
export function getMiyoServiceFilePath(): string {
  return path.join(os.homedir(), SERVICE_RELATIVE_PATH);
}

/**
 * Best-effort check for a running PID.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and parse the Miyo service.json file.
 */
export async function readMiyoServiceInfo(): Promise<MiyoServiceInfo | null> {
  try {
    const raw = await readFile(getMiyoServiceFilePath(), "utf8");
    const parsed = JSON.parse(raw) as MiyoServiceInfo;
    if (!parsed?.host || !parsed?.port) {
      logWarn("Miyo discovery: service.json missing host or port");
      return null;
    }
    return parsed;
  } catch (error) {
    logWarn("Miyo discovery: failed to read service.json", error);
    return null;
  }
}

/**
 * Discover the Miyo service from local service.json with a short TTL cache.
 */
export async function discoverMiyoService(
  options: { forceRefresh?: boolean } = {}
): Promise<MiyoDiscoveryResult | null> {
  if (!options.forceRefresh && cachedDiscovery && cachedDiscovery.expiresAt > Date.now()) {
    return cachedDiscovery.value;
  }

  const info = await readMiyoServiceInfo();
  if (!info) {
    return null;
  }

  if (typeof info.pid === "number" && info.pid > 0 && !isPidAlive(info.pid)) {
    logWarn("Miyo discovery: PID not running", info.pid);
    return null;
  }

  const baseUrl = `http://${info.host}:${info.port}`;
  const discovery: MiyoDiscoveryResult = { baseUrl, info };
  cachedDiscovery = {
    value: discovery,
    expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS,
  };

  logInfo("Miyo discovery: service detected", { baseUrl });
  return discovery;
}

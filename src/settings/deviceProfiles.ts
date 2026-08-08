/**
 * Per-device segmentation of device-specific agent settings (GitHub #2539).
 *
 * A coding-agent binary's location is device-specific, but `data.json` syncs
 * across devices. Storing the path as a single global value means syncing
 * overwrites one device's path with another's — and the UI then reports the
 * wrong path as "configured." The fix: keep device-specific fields under
 * `agentMode.deviceProfiles[deviceId]` and never as a global flat value.
 *
 * Rather than rewrite every reader/writer, we mirror the keychain pattern:
 * the in-memory settings keep the familiar flat shape
 * (`agentMode.claudeCli.path`, `agentMode.backends.*.binaryPath`, …), and two
 * pure transforms bridge memory ↔ disk:
 *
 *   - {@link hydrateDeviceProfile} (on load): populate the flat fields from this
 *     device's segment, stripping any flat copy already on disk first — that
 *     copy is a stale value synced from another device, so the segment is the
 *     sole source of truth (a device shows "not configured" until it has one).
 *   - {@link dehydrateDeviceProfile} (on save): move the flat fields into this
 *     device's segment and strip them from the top level. Other devices'
 *     segments are preserved.
 *
 * Only fields whose correct value differs per device move into a profile;
 * synced preferences like `defaultModel` / `enableThinking` stay in the flat
 * `backends.*` slices.
 */

import type { CopilotSettings, DeviceAgentProfile } from "@/settings/model";

type AgentMode = CopilotSettings["agentMode"];
type Backends = AgentMode["backends"];

function hasOwnKeys(obj: object): boolean {
  return Object.keys(obj).length > 0;
}

/** Shallow clone of `obj` with `keys` removed. */
function omitKeys<T extends object>(obj: T, keys: readonly string[]): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const key of keys) delete out[key];
  return out as T;
}

/** Device-specific field names per backend slice, removed on save / set on load. */
const CODEX_DEVICE_KEYS = ["binaryPath", "envOverrides"] as const;
const CLAUDE_DEVICE_KEYS = ["envOverrides"] as const;
const OPENCODE_DEVICE_KEYS = [
  "binaryPath",
  "binaryVersion",
  "binarySource",
  "probeSessionId",
  "envOverrides",
] as const;

/** Extract the device-specific fields from the flat agentMode shape into a profile. */
function buildProfileFromFlat(agentMode: AgentMode): DeviceAgentProfile {
  const profile: DeviceAgentProfile = {};

  const claudeCliPath = agentMode.claudeCli?.path;
  if (claudeCliPath) profile.claudeCliPath = claudeCliPath;

  const codexSrc = agentMode.backends?.codex;
  if (codexSrc) {
    const codex: NonNullable<DeviceAgentProfile["codex"]> = {};
    if (codexSrc.binaryPath) codex.binaryPath = codexSrc.binaryPath;
    if (codexSrc.envOverrides) codex.envOverrides = codexSrc.envOverrides;
    if (hasOwnKeys(codex)) profile.codex = codex;
  }

  const opencodeSrc = agentMode.backends?.opencode;
  if (opencodeSrc) {
    const opencode: NonNullable<DeviceAgentProfile["opencode"]> = {};
    if (opencodeSrc.binaryPath) opencode.binaryPath = opencodeSrc.binaryPath;
    if (opencodeSrc.binaryVersion) opencode.binaryVersion = opencodeSrc.binaryVersion;
    // binarySource describes the binary at binaryPath; keep them together so a
    // round-trip through `sanitizeDeviceAgentProfile` (which drops a sourceless
    // binarySource) can't silently strip it.
    if (opencodeSrc.binaryPath && opencodeSrc.binarySource) {
      opencode.binarySource = opencodeSrc.binarySource;
    }
    if (opencodeSrc.probeSessionId) opencode.probeSessionId = opencodeSrc.probeSessionId;
    if (opencodeSrc.envOverrides) opencode.envOverrides = opencodeSrc.envOverrides;
    if (hasOwnKeys(opencode)) profile.opencode = opencode;
  }

  const claudeSrc = agentMode.backends?.claude;
  if (claudeSrc?.envOverrides) {
    profile.claude = { envOverrides: claudeSrc.envOverrides };
  }

  return profile;
}

/** Return a copy of `backends` with every device-specific field removed (synced prefs kept). */
function stripDeviceFieldsFromBackends(backends: Backends | undefined): Backends {
  const out: Backends = {};
  if (!backends) return out;

  if (backends.codex) {
    const synced = omitKeys(backends.codex, CODEX_DEVICE_KEYS);
    if (hasOwnKeys(synced)) out.codex = synced;
  }
  if (backends.claude) {
    const synced = omitKeys(backends.claude, CLAUDE_DEVICE_KEYS);
    if (hasOwnKeys(synced)) out.claude = synced;
  }
  if (backends.opencode) {
    const synced = omitKeys(backends.opencode, OPENCODE_DEVICE_KEYS);
    if (hasOwnKeys(synced)) out.opencode = synced;
  }
  return out;
}

/**
 * Move this device's flat agent fields into `deviceProfiles[deviceId]` and
 * strip them from the top level, for persistence. Pure: returns a new object.
 */
export function dehydrateDeviceProfile(
  settings: CopilotSettings,
  deviceId: string
): CopilotSettings {
  const agentMode = settings?.agentMode;
  if (!agentMode) return settings;

  const profile = buildProfileFromFlat(agentMode);
  const deviceProfiles = { ...(agentMode.deviceProfiles ?? {}) };
  if (hasOwnKeys(profile)) deviceProfiles[deviceId] = profile;
  else delete deviceProfiles[deviceId];

  const nextAgentMode: AgentMode = {
    ...agentMode,
    claudeCli: undefined,
    backends: stripDeviceFieldsFromBackends(agentMode.backends),
    deviceProfiles: hasOwnKeys(deviceProfiles) ? deviceProfiles : undefined,
  };
  return { ...settings, agentMode: nextAgentMode };
}

/**
 * Populate the flat agent fields from this device's `deviceProfiles[deviceId]`
 * segment, for runtime use. Pure. Any device-specific flat field already on disk
 * is stripped first — it is a stale value synced from another device — so a
 * device with no segment of its own shows "not configured."
 */
export function hydrateDeviceProfile(settings: CopilotSettings, deviceId: string): CopilotSettings {
  const agentMode = settings.agentMode;
  if (!agentMode) return settings;
  const profile = agentMode.deviceProfiles?.[deviceId];

  // Strip stale flat device fields, keeping only synced prefs, then layer this
  // device's segment on top. Each profile slice holds exactly its backend's
  // device-specific fields, so the spread restores them without clobbering a
  // synced pref with `undefined` — the precise inverse of `buildProfileFromFlat`.
  const nextBackends = stripDeviceFieldsFromBackends(agentMode.backends);
  if (profile?.codex) nextBackends.codex = { ...nextBackends.codex, ...profile.codex };
  if (profile?.opencode) nextBackends.opencode = { ...nextBackends.opencode, ...profile.opencode };
  if (profile?.claude) nextBackends.claude = { ...nextBackends.claude, ...profile.claude };

  const nextAgentMode: AgentMode = {
    ...agentMode,
    backends: nextBackends,
    claudeCli: profile?.claudeCliPath ? { path: profile.claudeCliPath } : undefined,
  };
  return { ...settings, agentMode: nextAgentMode };
}

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
 *   - {@link hydrateDeviceProfile} (on load): copy this device's segment into
 *     the flat fields. When the device has no segment yet, the flat fields are
 *     left untouched (legacy passthrough until the v6 migration + first save).
 *   - {@link dehydrateDeviceProfile} (on save): move the flat fields into this
 *     device's segment and strip them from the top level. Other devices'
 *     segments are preserved.
 *
 * Only fields whose correct value differs per device move into a profile;
 * synced preferences like `defaultModel` / `enableThinking` stay in the flat
 * `backends.*` slices.
 */

import type { CopilotSettings, DeviceAgentProfile } from "@/settings/model";
import { DEVICE_PROFILES_SETTINGS_VERSION } from "@/settings/migrations/version";

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
 * strip them from the top level, for persistence. Pure: returns a new object
 * (or the original when below the device-profiles settings version, so legacy
 * vaults keep their flat fields on disk until the v6 migration runs).
 */
export function dehydrateDeviceProfile(
  settings: CopilotSettings,
  deviceId: string
): CopilotSettings {
  if ((settings?.settingsVersion ?? 0) < DEVICE_PROFILES_SETTINGS_VERSION) return settings;
  const agentMode = settings.agentMode;
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
 * segment, for runtime use. Pure. When the device has no segment, returns the
 * original settings untouched — so legacy flat fields (pre-migration) pass
 * through, and a synced vault from another device shows "not configured."
 */
export function hydrateDeviceProfile(settings: CopilotSettings, deviceId: string): CopilotSettings {
  const agentMode = settings.agentMode;
  if (!agentMode) return settings;
  const profile = agentMode.deviceProfiles?.[deviceId];
  if (!profile) return settings;

  const backends = agentMode.backends ?? {};
  const nextBackends: Backends = { ...backends };

  // Each profile slice holds exactly this backend's device-specific fields, so
  // spreading it onto the synced slice restores those fields without clobbering
  // a synced pref with `undefined` — the precise inverse of `buildProfileFromFlat`.
  if (profile.codex) nextBackends.codex = { ...backends.codex, ...profile.codex };
  if (profile.opencode) nextBackends.opencode = { ...backends.opencode, ...profile.opencode };
  if (profile.claude) nextBackends.claude = { ...backends.claude, ...profile.claude };

  const nextAgentMode: AgentMode = {
    ...agentMode,
    backends: nextBackends,
    claudeCli: profile.claudeCliPath ? { path: profile.claudeCliPath } : undefined,
  };
  return { ...settings, agentMode: nextAgentMode };
}

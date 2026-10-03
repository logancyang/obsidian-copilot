// Device-specific fields live in per-device segments because `data.json` syncs across devices:
// https://github.com/logancyang/obsidian-copilot/issues/2539

import {
  COMPANION_BACKEND_IDS,
  type CopilotSettings,
  type DeviceAgentProfile,
} from "@/settings/model";

type AgentMode = CopilotSettings["agentMode"];
type Backends = AgentMode["backends"];

function hasOwnKeys(obj: object): boolean {
  return Object.keys(obj).length > 0;
}

function omitKeys<T extends object>(obj: T, keys: readonly string[]): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const key of keys) delete out[key];
  return out as T;
}

const CODEX_DEVICE_KEYS = ["binaryPath", "binaryVersion", "binarySource", "envOverrides"] as const;
const CLAUDE_DEVICE_KEYS = ["envOverrides"] as const;
const OPENCODE_DEVICE_KEYS = [
  "binaryPath",
  "binaryVersion",
  "binarySource",
  "probeSessionId",
  "envOverrides",
] as const;

function buildProfileFromFlat(agentMode: AgentMode): DeviceAgentProfile {
  const profile: DeviceAgentProfile = {};

  const claudeCliPath = agentMode.claudeCli?.path;
  if (claudeCliPath) profile.claudeCliPath = claudeCliPath;

  const codexSrc = agentMode.backends?.codex;
  if (codexSrc) {
    const codex: NonNullable<DeviceAgentProfile["codex"]> = {};
    if (codexSrc.binaryPath) codex.binaryPath = codexSrc.binaryPath;
    if (codexSrc.binaryVersion) codex.binaryVersion = codexSrc.binaryVersion;
    if (codexSrc.binaryPath && codexSrc.binarySource) {
      codex.binarySource = codexSrc.binarySource;
    }
    if (codexSrc.envOverrides) codex.envOverrides = codexSrc.envOverrides;
    if (hasOwnKeys(codex)) profile.codex = codex;
  }

  const opencodeSrc = agentMode.backends?.opencode;
  if (opencodeSrc) {
    const opencode: NonNullable<DeviceAgentProfile["opencode"]> = {};
    if (opencodeSrc.binaryPath) opencode.binaryPath = opencodeSrc.binaryPath;
    if (opencodeSrc.binaryVersion) opencode.binaryVersion = opencodeSrc.binaryVersion;
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

  for (const id of COMPANION_BACKEND_IDS) {
    const source = agentMode.backends?.[id];
    if (source) {
      const fields = Object.fromEntries(
        CODEX_DEVICE_KEYS.filter((key) => source[key] !== undefined).map((key) => [
          key,
          source[key],
        ])
      );
      if (hasOwnKeys(fields)) profile[id] = fields;
    }
  }
  return profile;
}

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
  for (const id of COMPANION_BACKEND_IDS) {
    if (backends[id]) {
      const synced = omitKeys(backends[id], CODEX_DEVICE_KEYS);
      if (hasOwnKeys(synced)) out[id] = synced;
    }
  }
  return out;
}

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

export function hydrateDeviceProfile(settings: CopilotSettings, deviceId: string): CopilotSettings {
  const agentMode = settings.agentMode;
  if (!agentMode) return settings;
  const profile = agentMode.deviceProfiles?.[deviceId];

  const nextBackends = stripDeviceFieldsFromBackends(agentMode.backends);
  if (profile?.codex) nextBackends.codex = { ...nextBackends.codex, ...profile.codex };
  if (profile?.opencode) nextBackends.opencode = { ...nextBackends.opencode, ...profile.opencode };
  if (profile?.claude) nextBackends.claude = { ...nextBackends.claude, ...profile.claude };

  for (const id of COMPANION_BACKEND_IDS) {
    if (profile?.[id]) nextBackends[id] = { ...nextBackends[id], ...profile[id] };
  }
  const nextAgentMode: AgentMode = {
    ...agentMode,
    backends: nextBackends,
    claudeCli: profile?.claudeCliPath ? { path: profile.claudeCliPath } : undefined,
  };
  return { ...settings, agentMode: nextAgentMode };
}

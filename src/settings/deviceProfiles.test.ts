import { dehydrateDeviceProfile, hydrateDeviceProfile } from "@/settings/deviceProfiles";
import { sanitizeSettings, type CopilotSettings } from "@/settings/model";

type AgentMode = CopilotSettings["agentMode"];

function makeAgentMode(partial: Partial<AgentMode> = {}): AgentMode {
  return {
    byok: {},
    mcpServers: [],
    activeBackend: "opencode",
    backends: {},
    debugFullFrames: false,
    welcomeDismissed: false,
    skills: { folder: "copilot/skills" },
    ...partial,
  };
}

function makeSettings(agentMode: AgentMode, settingsVersion = 6): CopilotSettings {
  return { settingsVersion, agentMode } as unknown as CopilotSettings;
}

const DEVICE_A = "device-a";
const DEVICE_B = "device-b";

describe("dehydrateDeviceProfile", () => {
  it("moves device-specific flat fields into deviceProfiles[deviceId] and strips them", () => {
    const settings = makeSettings(
      makeAgentMode({
        claudeCli: { path: "/a/claude" },
        backends: {
          codex: { binaryPath: "/a/codex", envOverrides: { FOO: "1" } },
          opencode: {
            binaryPath: "/a/opencode",
            binaryVersion: "1.2.3",
            binarySource: "custom",
            probeSessionId: "sess-1",
          },
        },
      })
    );

    const out = dehydrateDeviceProfile(settings, DEVICE_A);

    // Flat fields stripped from the top level.
    expect(out.agentMode.claudeCli).toBeUndefined();
    expect(out.agentMode.backends.codex?.binaryPath).toBeUndefined();
    expect(out.agentMode.backends.opencode?.binaryPath).toBeUndefined();

    // Moved into this device's segment.
    expect(out.agentMode.deviceProfiles?.[DEVICE_A]).toEqual({
      claudeCliPath: "/a/claude",
      codex: { binaryPath: "/a/codex", envOverrides: { FOO: "1" } },
      opencode: {
        binaryPath: "/a/opencode",
        binaryVersion: "1.2.3",
        binarySource: "custom",
        probeSessionId: "sess-1",
      },
    });
  });

  it("keeps synced (non-device) prefs like defaultModel in the flat backends slice", () => {
    const settings = makeSettings(
      makeAgentMode({
        backends: {
          codex: { binaryPath: "/a/codex", defaultModel: { baseModelId: "gpt-5", effort: null } },
          claude: { enableThinking: true, envOverrides: { BAR: "2" } },
        },
      })
    );

    const out = dehydrateDeviceProfile(settings, DEVICE_A);

    expect(out.agentMode.backends.codex?.defaultModel).toEqual({
      baseModelId: "gpt-5",
      effort: null,
    });
    expect(out.agentMode.backends.claude?.enableThinking).toBe(true);
    // Device-specific bits moved out.
    expect(out.agentMode.backends.codex?.binaryPath).toBeUndefined();
    expect(out.agentMode.deviceProfiles?.[DEVICE_A]?.codex?.binaryPath).toBe("/a/codex");
    expect(out.agentMode.deviceProfiles?.[DEVICE_A]?.claude?.envOverrides).toEqual({ BAR: "2" });
  });

  it("preserves other devices' segments and removes own when empty", () => {
    const settings = makeSettings(
      makeAgentMode({
        deviceProfiles: { [DEVICE_B]: { claudeCliPath: "/b/claude" } },
      })
    );

    const out = dehydrateDeviceProfile(settings, DEVICE_A);

    // Device A has nothing configured → no own segment created.
    expect(out.agentMode.deviceProfiles?.[DEVICE_A]).toBeUndefined();
    // Device B's segment untouched.
    expect(out.agentMode.deviceProfiles?.[DEVICE_B]).toEqual({ claudeCliPath: "/b/claude" });
  });
});

describe("hydrateDeviceProfile", () => {
  it("populates flat fields from this device's segment", () => {
    const settings = makeSettings(
      makeAgentMode({
        deviceProfiles: {
          [DEVICE_A]: {
            claudeCliPath: "/a/claude",
            opencode: { binaryPath: "/a/opencode", binaryVersion: "9.9", binarySource: "managed" },
          },
        },
      })
    );

    const out = hydrateDeviceProfile(settings, DEVICE_A);

    expect(out.agentMode.claudeCli?.path).toBe("/a/claude");
    expect(out.agentMode.backends.opencode?.binaryPath).toBe("/a/opencode");
    expect(out.agentMode.backends.opencode?.binarySource).toBe("managed");
  });

  it("ignores stale global flat fields when this device has no segment", () => {
    // A synced data.json may still carry another device's flat paths. With no
    // segment of its own, this device must treat them as not configured.
    const settings = makeSettings(
      makeAgentMode({
        claudeCli: { path: "/stale/claude" },
        backends: { codex: { binaryPath: "/stale/codex" } },
        deviceProfiles: { [DEVICE_B]: { claudeCliPath: "/b/claude" } },
      })
    );
    const out = hydrateDeviceProfile(settings, DEVICE_A);
    expect(out.agentMode.claudeCli).toBeUndefined();
    expect(out.agentMode.backends.codex?.binaryPath).toBeUndefined();
  });

  it("merges segment fields onto synced backend prefs without clobbering them", () => {
    const settings = makeSettings(
      makeAgentMode({
        backends: { codex: { defaultModel: { baseModelId: "gpt-5", effort: null } } },
        deviceProfiles: { [DEVICE_A]: { codex: { binaryPath: "/a/codex" } } },
      })
    );

    const out = hydrateDeviceProfile(settings, DEVICE_A);

    expect(out.agentMode.backends.codex?.defaultModel).toEqual({
      baseModelId: "gpt-5",
      effort: null,
    });
    expect(out.agentMode.backends.codex?.binaryPath).toBe("/a/codex");
  });

  it("drops stale device-specific flat fields, taking device fields only from the profile", () => {
    // A synced data.json may carry another device's opencode binaryVersion/
    // binarySource as flat values. Hydrate ignores them and takes device fields
    // only from this device's segment, which configures binaryPath alone.
    const settings = makeSettings(
      makeAgentMode({
        backends: { opencode: { binaryVersion: "9.9", binarySource: "managed" } },
        deviceProfiles: { [DEVICE_A]: { opencode: { binaryPath: "/a/oc" } } },
      })
    );

    const out = hydrateDeviceProfile(settings, DEVICE_A);

    expect(out.agentMode.backends.opencode?.binaryPath).toBe("/a/oc");
    expect(out.agentMode.backends.opencode?.binaryVersion).toBeUndefined();
    expect(out.agentMode.backends.opencode?.binarySource).toBeUndefined();
  });
});

describe("hydrate ∘ dehydrate round trip", () => {
  it("restores the same flat fields for the same device", () => {
    const agentMode = makeAgentMode({
      claudeCli: { path: "/a/claude" },
      backends: {
        opencode: { binaryPath: "/a/oc", binaryVersion: "1.0", binarySource: "custom" },
        codex: { defaultModel: { baseModelId: "gpt-5", effort: null }, binaryPath: "/a/cx" },
      },
    });
    const settings = makeSettings(agentMode);

    const disk = dehydrateDeviceProfile(settings, DEVICE_A);
    const restored = hydrateDeviceProfile(disk, DEVICE_A);

    expect(restored.agentMode.claudeCli?.path).toBe("/a/claude");
    expect(restored.agentMode.backends.opencode?.binaryPath).toBe("/a/oc");
    expect(restored.agentMode.backends.codex?.binaryPath).toBe("/a/cx");
    expect(restored.agentMode.backends.codex?.defaultModel?.baseModelId).toBe("gpt-5");
  });

  it("isolates devices: a path configured on A is invisible to B but survives B's save", () => {
    // Device A configures and saves.
    const aDisk = dehydrateDeviceProfile(
      makeSettings(makeAgentMode({ claudeCli: { path: "/a/claude" } })),
      DEVICE_A
    );

    // Synced to device B and loaded: B sees no path of its own.
    const bLoaded = hydrateDeviceProfile(aDisk, DEVICE_B);
    expect(bLoaded.agentMode.claudeCli).toBeUndefined();

    // B configures its own path and saves.
    const bConfigured = {
      ...bLoaded,
      agentMode: { ...bLoaded.agentMode, claudeCli: { path: "/b/claude" } },
    } as CopilotSettings;
    const bDisk = dehydrateDeviceProfile(bConfigured, DEVICE_B);

    // Both segments coexist; each device resolves its own binary.
    expect(bDisk.agentMode.deviceProfiles?.[DEVICE_A]?.claudeCliPath).toBe("/a/claude");
    expect(bDisk.agentMode.deviceProfiles?.[DEVICE_B]?.claudeCliPath).toBe("/b/claude");
    expect(hydrateDeviceProfile(bDisk, DEVICE_A).agentMode.claudeCli?.path).toBe("/a/claude");
    expect(hydrateDeviceProfile(bDisk, DEVICE_B).agentMode.claudeCli?.path).toBe("/b/claude");
  });
});

describe("sanitizeSettings round-trips deviceProfiles", () => {
  it("preserves a valid profile map and drops empty/invalid entries", () => {
    const raw = {
      agentMode: {
        deviceProfiles: {
          [DEVICE_A]: {
            claudeCliPath: "/a/claude",
            opencode: { binaryPath: "/a/oc", binaryVersion: "1", binarySource: "custom" },
            codex: { envOverrides: { GOOD: "1", "bad-key": "x" } },
          },
          [DEVICE_B]: {}, // empty → dropped
          "": { claudeCliPath: "/x" }, // empty key → dropped
        },
      },
    };

    const out = sanitizeSettings(raw as unknown as CopilotSettings);
    const profiles = out.agentMode.deviceProfiles ?? {};

    expect(profiles[DEVICE_A]?.claudeCliPath).toBe("/a/claude");
    expect(profiles[DEVICE_A]?.opencode?.binarySource).toBe("custom");
    // Invalid env key dropped, valid kept.
    expect(profiles[DEVICE_A]?.codex?.envOverrides).toEqual({ GOOD: "1" });
    expect(profiles[DEVICE_B]).toBeUndefined();
    expect(profiles[""]).toBeUndefined();
  });
});

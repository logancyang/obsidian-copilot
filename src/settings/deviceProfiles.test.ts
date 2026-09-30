import { dehydrateDeviceProfile, hydrateDeviceProfile } from "@/settings/deviceProfiles";
import type { CopilotSettings } from "@/settings/model";

type AgentMode = CopilotSettings["agentMode"];

function makeAgentMode(partial: Partial<AgentMode> = {}): AgentMode {
  return {
    byok: {},
    activeBackend: "opencode",
    backends: {},
    debugFullFrames: false,
    notificationSound: false,
    notificationSoundId: "piano",
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

describe("deviceProfiles", () => {
  describe("dehydrateDeviceProfile()", () => {
    it("moves device-specific flat fields into deviceProfiles[deviceId] and strips them", () => {
      const settings = makeSettings(
        makeAgentMode({
          claudeCli: { path: "/a/claude" },
          backends: {
            codex: {
              binaryPath: "/a/codex",
              binaryVersion: "1.10.0-r1",
              binarySource: "managed",
              envOverrides: { FOO: "1" },
            },
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

      expect(out.agentMode.claudeCli).toBeUndefined();
      expect(out.agentMode.backends.codex?.binaryPath).toBeUndefined();
      expect(out.agentMode.backends.opencode?.binaryPath).toBeUndefined();

      expect(out.agentMode.deviceProfiles?.[DEVICE_A]).toEqual({
        claudeCliPath: "/a/claude",
        codex: {
          binaryPath: "/a/codex",
          binaryVersion: "1.10.0-r1",
          binarySource: "managed",
          envOverrides: { FOO: "1" },
        },
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

      expect(out.agentMode.deviceProfiles?.[DEVICE_A]).toBeUndefined();
      expect(out.agentMode.deviceProfiles?.[DEVICE_B]).toEqual({ claudeCliPath: "/b/claude" });
    });
  });

  describe("hydrateDeviceProfile()", () => {
    it("populates flat fields from this device's segment", () => {
      const settings = makeSettings(
        makeAgentMode({
          deviceProfiles: {
            [DEVICE_A]: {
              claudeCliPath: "/a/claude",
              opencode: {
                binaryPath: "/a/opencode",
                binaryVersion: "9.9",
                binarySource: "managed",
              },
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

    it("keeps a Codex managed install's ownership and version on the same device", () => {
      const settings = makeSettings(
        makeAgentMode({
          deviceProfiles: {
            [DEVICE_A]: {
              codex: {
                binaryPath: "/a/codex",
                binaryVersion: "1.10.0-r1",
                binarySource: "managed",
              },
            },
          },
        })
      );

      const out = hydrateDeviceProfile(settings, DEVICE_A);

      expect(out.agentMode.backends.codex).toMatchObject({
        binaryPath: "/a/codex",
        binaryVersion: "1.10.0-r1",
        binarySource: "managed",
      });
    });

    it("drops stale device-specific flat fields, taking device fields only from the profile", () => {
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
      const aDisk = dehydrateDeviceProfile(
        makeSettings(makeAgentMode({ claudeCli: { path: "/a/claude" } })),
        DEVICE_A
      );

      const bLoaded = hydrateDeviceProfile(aDisk, DEVICE_B);
      expect(bLoaded.agentMode.claudeCli).toBeUndefined();

      const bConfigured = {
        ...bLoaded,
        agentMode: { ...bLoaded.agentMode, claudeCli: { path: "/b/claude" } },
      } as CopilotSettings;
      const bDisk = dehydrateDeviceProfile(bConfigured, DEVICE_B);

      expect(bDisk.agentMode.deviceProfiles?.[DEVICE_A]?.claudeCliPath).toBe("/a/claude");
      expect(bDisk.agentMode.deviceProfiles?.[DEVICE_B]?.claudeCliPath).toBe("/b/claude");
      expect(hydrateDeviceProfile(bDisk, DEVICE_A).agentMode.claudeCli?.path).toBe("/a/claude");
      expect(hydrateDeviceProfile(bDisk, DEVICE_B).agentMode.claudeCli?.path).toBe("/b/claude");
    });
  });
});

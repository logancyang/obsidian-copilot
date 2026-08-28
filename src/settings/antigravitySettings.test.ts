import { DEFAULT_SETTINGS } from "@/constants";
import type { CustomModel } from "@/aiParams";
import { sanitizeSettings, type CopilotSettings } from "@/settings/model";

describe("Antigravity settings compatibility", () => {
  it("preserves a valid Antigravity backend and filters malformed fields", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      agentMode: {
        ...DEFAULT_SETTINGS.agentMode,
        backends: {
          antigravity: {
            binaryPath: "C:\\Users\\me\\AppData\\Local\\agy\\bin\\agy.exe",
            defaultModel: { baseModelId: "gemini-3.7-flash-high", effort: "high" },
            envOverrides: {
              AGY_PROFILE: "personal",
              "not-a-variable": "drop me",
              BAD_VALUE: 42,
            },
          },
        },
      },
    } as unknown as CopilotSettings;

    expect(sanitizeSettings(settings).agentMode.backends.antigravity).toEqual({
      binaryPath: "C:\\Users\\me\\AppData\\Local\\agy\\bin\\agy.exe",
      defaultModel: { baseModelId: "gemini-3.7-flash-high", effort: "high" },
      envOverrides: { AGY_PROFILE: "personal" },
    });
  });

  it("keeps old settings valid when Antigravity was never configured", () => {
    const sanitized = sanitizeSettings({
      ...DEFAULT_SETTINGS,
      agentMode: { ...DEFAULT_SETTINGS.agentMode, backends: {} },
    });

    expect(sanitized.agentMode.backends.antigravity).toBeUndefined();
  });

  it("round-trips Antigravity device-owned fields", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      agentMode: {
        ...DEFAULT_SETTINGS.agentMode,
        backends: { antigravity: { defaultModel: { baseModelId: "gemini-3.1-pro-high" } } },
        deviceProfiles: {
          laptop: {
            antigravity: {
              binaryPath: "C:\\Users\\me\\AppData\\Local\\agy\\bin\\agy.exe",
              envOverrides: { AGY_PROFILE: "laptop" },
            },
          },
        },
      },
    } as unknown as CopilotSettings;

    const sanitized = sanitizeSettings(settings);
    expect(sanitized.agentMode.deviceProfiles?.laptop).toEqual({
      antigravity: {
        binaryPath: "C:\\Users\\me\\AppData\\Local\\agy\\bin\\agy.exe",
        envOverrides: { AGY_PROFILE: "laptop" },
      },
    });
  });

  it("allows agent-origin models to carry their binding without an API key", () => {
    const model: CustomModel = {
      name: "gpt-5.5",
      provider: "openai-compatible",
      agentType: "codex",
      requiresApiKey: false,
      enabled: true,
    };

    expect(model.agentType).toBe("codex");
    expect(model.requiresApiKey).toBe(false);
  });
});

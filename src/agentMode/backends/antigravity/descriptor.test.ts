import type { CopilotSettings } from "@/settings/model";
import { AntigravityBackendDescriptor } from "./descriptor";

function settings(): CopilotSettings {
  return {
    backends: {
      antigravity: { enabledModels: ["gemini-2.5-pro"] },
    },
    configuredModels: [
      {
        configuredModelId: "gemini-2.5-pro",
        providerId: "antigravity-agent",
        info: {
          id: "gemini-2.5-pro",
          displayName: "Gemini 2.5 Pro",
        },
        configuredAt: 0,
      },
    ],
  } as unknown as CopilotSettings;
}

describe("AntigravityBackendDescriptor", () => {
  it("declares Antigravity as a cloud Agent backend", () => {
    expect(AntigravityBackendDescriptor.id).toBe("antigravity");
    expect(AntigravityBackendDescriptor.displayName).toBe("Antigravity");
    expect(AntigravityBackendDescriptor.selfHostable).toBe(false);
    expect(AntigravityBackendDescriptor.routesCopilotModels).toBe(false);
    expect(AntigravityBackendDescriptor.setupDescription).toContain("Antigravity");
  });

  it("uses the Agent account catalog for enabled models", () => {
    expect(AntigravityBackendDescriptor.getEnabledModelEntries?.(settings())).toEqual([
      expect.objectContaining({
        baseModelId: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        credentialState: "ok",
      }),
    ]);
  });

  it("keeps model wire ids as the CLI model slug", () => {
    const selection = { baseModelId: "gemini-2.5-pro", effort: null } as const;
    expect(AntigravityBackendDescriptor.wire.encode(selection)).toBe("gemini-2.5-pro");
    expect(AntigravityBackendDescriptor.wire.decode("gemini-2.5-pro")).toEqual({
      selection,
      provider: null,
    });
  });
});

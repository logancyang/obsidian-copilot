import type { CopilotSettings } from "@/settings/model";
import { getActiveBackendDescriptor, listBackendDescriptors } from "./registry";
import { OpencodeBackendDescriptor } from "./opencode/descriptor";

jest.mock("@/agentMode/backends/opencode/OpencodeInstallModal", () => ({
  OpencodeInstallModal: class {},
}));
jest.mock("@/components/modals/ConfirmModal", () => ({ ConfirmModal: class {} }));
jest.mock("@/components/ui/setting-item", () => ({ SettingItem: () => null }));
jest.mock("@/components/ui/button", () => ({ Button: () => null }));
jest.mock("@/components/ui/input", () => ({ Input: () => null }));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("obsidian", () => ({
  Modal: class {},
  Notice: class {},
  Platform: { isMobile: false },
}));

describe("backendRegistry", () => {
  const baseSettings = (activeBackend?: string): CopilotSettings =>
    ({
      agentMode: {
        enabled: true,
        byok: {},
        mcpServers: [],
        activeBackend: activeBackend ?? "opencode",
        backends: { opencode: {} },
      },
    }) as unknown as CopilotSettings;

  it("returns the OpenCode descriptor by default", () => {
    expect(getActiveBackendDescriptor(baseSettings())).toBe(OpencodeBackendDescriptor);
  });

  it("falls back to OpenCode when an unknown backend is selected", () => {
    expect(getActiveBackendDescriptor(baseSettings("nonexistent"))).toBe(OpencodeBackendDescriptor);
  });

  it("listBackendDescriptors includes OpenCode", () => {
    expect(listBackendDescriptors()).toContain(OpencodeBackendDescriptor);
  });
});

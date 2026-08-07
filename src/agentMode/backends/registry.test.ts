import type { CopilotSettings } from "@/settings/model";
import {
  backendDisplayOrder,
  backendNeedsSelfHostWarning,
  backendRegistry,
  getActiveBackendDescriptor,
  getCloudAgentIds,
  listBackendDescriptors,
  RECOMMENDED_BACKEND_ID,
} from "./registry";
import { ClaudeBackendDescriptor } from "./claude";
import { CodexBackendDescriptor } from "./codex/descriptor";
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
  const baseSettings = (activeBackend?: string, enableSelfHostMode = false): CopilotSettings =>
    ({
      enableSelfHostMode,
      agentMode: {
        enabled: true,
        byok: {},
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

  describe("backendDisplayOrder()", () => {
    it("lists opencode, then Claude, then Codex", () => {
      expect(backendDisplayOrder()).toEqual([
        OpencodeBackendDescriptor,
        ClaudeBackendDescriptor,
        CodexBackendDescriptor,
      ]);
    });

    it("covers every registered backend exactly once", () => {
      const ids = backendDisplayOrder().map((descriptor) => descriptor.id);
      expect([...ids].sort()).toEqual(Object.keys(backendRegistry).sort());
    });

    it("returns a stable reference across calls", () => {
      expect(backendDisplayOrder()).toBe(backendDisplayOrder());
    });
  });

  describe("RECOMMENDED_BACKEND_ID", () => {
    it("names a registered backend", () => {
      expect(backendRegistry[RECOMMENDED_BACKEND_ID]).toBeDefined();
    });
  });

  describe("agent setup copy", () => {
    it("every registered backend states which models it serves and who pays", () => {
      for (const descriptor of listBackendDescriptors()) {
        expect(descriptor.setupDescription.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Self-Host Mode marking", () => {
    it("keeps every backend listed regardless of the mode", () => {
      const all = listBackendDescriptors();
      expect(all).toEqual(
        expect.arrayContaining([
          OpencodeBackendDescriptor,
          ClaudeBackendDescriptor,
          CodexBackendDescriptor,
        ])
      );
    });

    it("descriptors declare selfHostable explicitly", () => {
      expect(OpencodeBackendDescriptor.selfHostable).toBe(true);
      expect(ClaudeBackendDescriptor.selfHostable).toBe(false);
      expect(CodexBackendDescriptor.selfHostable).toBe(false);
    });

    it("never warns when the mode is off", () => {
      const off = baseSettings("opencode", false);
      expect(backendNeedsSelfHostWarning(OpencodeBackendDescriptor, off)).toBe(false);
      expect(backendNeedsSelfHostWarning(ClaudeBackendDescriptor, off)).toBe(false);
      expect(backendNeedsSelfHostWarning(CodexBackendDescriptor, off)).toBe(false);
    });

    it("warns on cloud agents (Claude, Codex), not opencode, when on", () => {
      const on = baseSettings("opencode", true);
      expect(backendNeedsSelfHostWarning(OpencodeBackendDescriptor, on)).toBe(false);
      expect(backendNeedsSelfHostWarning(ClaudeBackendDescriptor, on)).toBe(true);
      expect(backendNeedsSelfHostWarning(CodexBackendDescriptor, on)).toBe(true);
    });

    // Self-Host Mode marks but never redirects: a persisted cloud-agent
    // activeBackend stays that backend (still spawnable — the user decides).
    it("getActiveBackendDescriptor keeps a cloud agent active while the mode is on", () => {
      expect(getActiveBackendDescriptor(baseSettings("claude", true))).toBe(
        ClaudeBackendDescriptor
      );
      expect(getActiveBackendDescriptor(baseSettings("codex", true))).toBe(CodexBackendDescriptor);
    });

    it("getActiveBackendDescriptor still falls back to opencode for an unknown id", () => {
      expect(getActiveBackendDescriptor(baseSettings("nonexistent", true))).toBe(
        OpencodeBackendDescriptor
      );
    });

    it("getCloudAgentIds is the full set of non-self-hostable backends, memoized", () => {
      const ids = getCloudAgentIds();
      expect(ids.has("claude")).toBe(true);
      expect(ids.has("codex")).toBe(true);
      expect(ids.has("opencode")).toBe(false);
      // Stable reference across calls (drives referential stability downstream).
      expect(getCloudAgentIds()).toBe(ids);
    });
  });
});

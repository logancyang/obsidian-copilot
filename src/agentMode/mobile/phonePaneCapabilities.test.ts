import { createPhonePaneCapabilities } from "@/agentMode/mobile/phonePaneCapabilities";
import { REMOTE_IMAGE_BYTES_PER_COMMAND } from "@/agentMode/protocol/limits";
import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import { buildBackendSummary, buildHostState } from "@/agentMode/protocol/testBuilders";

const clientWith = (displayName: string): SessionClient =>
  ({
    getHost: () =>
      buildHostState({ backends: [buildBackendSummary({ id: "claude", displayName })] }),
  }) as unknown as SessionClient;

describe("phonePaneCapabilities", () => {
  describe("createPhonePaneCapabilities()", () => {
    it("omits every capability that would touch the desktop's files, editor or settings https://github.com/Brevilabs/obsidian-copilot-private/issues/613", () => {
      const capabilities = createPhonePaneCapabilities(clientWith("Claude"));

      expect(capabilities.persistDefaults).toBeUndefined();
      expect(capabilities.openPath).toBeUndefined();
      expect(capabilities.openPlanPreview).toBeUndefined();
      expect(capabilities.closePlanPreview).toBeUndefined();
      expect(capabilities.insertAtCursor).toBeUndefined();
      expect(capabilities.vaultBase).toBeNull();
    });

    it("names an agent from the desktop's catalog and has no name for an unknown one", () => {
      const capabilities = createPhonePaneCapabilities(clientWith("Claude Code"));

      expect(capabilities.backendName?.("claude")).toBe("Claude Code");
      expect(capabilities.backendName?.("mystery")).toBeUndefined();
    });

    it("supplies the shipped logos for the known agents and none for an unknown one", () => {
      const capabilities = createPhonePaneCapabilities(clientWith("Claude"));

      expect(capabilities.backendIcon?.("claude")).toBeDefined();
      expect(capabilities.backendIcon?.("codex")).toBeDefined();
      expect(capabilities.backendIcon?.("opencode")).toBeDefined();
      expect(capabilities.backendIcon?.("mystery")).toBeUndefined();
    });

    it("lets the desktop decide multi-agent mentions and caps images to what one frame carries", () => {
      const capabilities = createPhonePaneCapabilities(clientWith("Claude"));

      expect(capabilities.multiAgentAllowed).toBe(true);
      expect(capabilities.imageBytesBudget).toBe(REMOTE_IMAGE_BYTES_PER_COMMAND);
    });
  });
});

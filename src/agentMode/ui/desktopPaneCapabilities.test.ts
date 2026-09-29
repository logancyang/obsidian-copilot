import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import { createDesktopPaneCapabilities } from "@/agentMode/ui/desktopPaneCapabilities";
import { closePlanPreview, openPlanPreview } from "@/agentMode/ui/PlanPreviewView";
import { insertAtCursor } from "@/utils";
import { openVaultPath } from "@/utils/openVaultPath";
import { getVaultBase } from "@/utils/vaultPath";
import type { App } from "obsidian";

jest.mock("@/utils", () => ({ insertAtCursor: jest.fn() }));
jest.mock("@/utils/openVaultPath", () => ({ openVaultPath: jest.fn() }));
jest.mock("@/utils/vaultPath", () => ({ getVaultBase: jest.fn(() => "/Users/me/vault") }));
jest.mock("@/agentMode/ui/PlanPreviewView", () => ({
  openPlanPreview: jest.fn().mockResolvedValue(undefined),
  closePlanPreview: jest.fn(),
}));

const app = { name: "app" } as unknown as App;
const client = { name: "client" } as unknown as SessionClient;

describe("desktopPaneCapabilities", () => {
  describe("createDesktopPaneCapabilities()", () => {
    beforeEach(() => jest.clearAllMocks());

    it("reports the vault's folder on disk", () => {
      expect(createDesktopPaneCapabilities(app, client).vaultBase).toBe("/Users/me/vault");
      expect(getVaultBase).toHaveBeenCalledWith(app);
    });

    it("opens a path through the vault opener with the options it was given", () => {
      createDesktopPaneCapabilities(app, client).openPath?.("notes/a.md", { newLeaf: true });
      expect(openVaultPath).toHaveBeenCalledWith(app, "notes/a.md", { newLeaf: true });
    });

    it("inserts text through the workspace editor", () => {
      createDesktopPaneCapabilities(app, client).insertAtCursor?.("Draft");
      expect(insertAtCursor).toHaveBeenCalledWith(app, "Draft");
    });

    it("opens a plan preview that reads and answers through the same client", async () => {
      const request = {
        proposalId: "plan-1",
        sessionId: "s1",
        planMarkdown: "- Goals",
        title: "Outline",
      };

      await createDesktopPaneCapabilities(app, client).openPlanPreview?.(request);

      expect(openPlanPreview).toHaveBeenCalledWith(app, { ...request, client });
    });

    it("closes the preview of a proposal", () => {
      createDesktopPaneCapabilities(app, client).closePlanPreview?.("plan-1");
      expect(closePlanPreview).toHaveBeenCalledWith(app, "plan-1");
    });
  });
});

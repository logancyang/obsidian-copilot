import { ClientView } from "@/agentMode/protocol/ClientView";
import { buildTab } from "@/agentMode/protocol/testBuilders";
import { createFixtureClient, type FixtureClientOptions } from "@/agentMode/ui/agentPane.fixtures";
import { useTabCommands } from "@/agentMode/ui/hooks/useTabCommands";
import { logWarn } from "@/logger";
import { renderHook } from "@testing-library/react";

jest.mock("@/logger", () => ({ logWarn: jest.fn() }));

const GLOBAL = "__global__";

function rig(options: Partial<FixtureClientOptions> = {}, scope = GLOBAL) {
  const fixture = createFixtureClient({
    sessionId: "a",
    host: {
      tabs: [buildTab({ id: "a" }), buildTab({ id: "p", chatInputId: "in-p", projectId: "proj" })],
    },
    ...options,
  });
  const view = new ClientView(scope);
  view.reconcile(fixture.client.getHost());
  const { result } = renderHook(() => useTabCommands(fixture.client, view));
  return { fixture, view, commands: result.current };
}

describe("useTabCommands", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("useTabCommands()", () => {
    it("creates a session in the view's project scope and shows the one the host reports", async () => {
      const { fixture, view, commands } = rig(
        { onCommand: () => ({ ok: true, value: { sessionId: "fresh" } }) },
        "proj"
      );
      const result = await commands.createTab();
      expect(result).toEqual({ ok: true, value: { sessionId: "fresh" } });
      expect(fixture.commands).toEqual([{ name: "createSession", projectId: "proj" }]);
      expect(view.getState()).toEqual({ activeTabId: "fresh", projectScope: "proj" });
    });

    it("leaves the view alone and logs the host's reason when creating fails", async () => {
      const { view, commands } = rig({
        onCommand: () => ({ ok: false, code: "failed", message: "spawn failed" }),
      });
      view.activate({ id: "a", projectId: GLOBAL });
      const result = await commands.createTab();
      expect(result.ok).toBe(false);
      expect(view.getActiveTabId()).toBe("a");
      expect(logWarn).toHaveBeenCalledWith(
        "[AgentMode] createSession command failed (failed): spawn failed"
      );
    });

    it("shows a tab that is in the shared tab set, switching scope with it, without sending a command", () => {
      const { fixture, view, commands } = rig();
      commands.showTab("p");
      expect(view.getState()).toEqual({ activeTabId: "p", projectScope: "proj" });
      expect(fixture.commands).toEqual([]);
    });

    it("ignores a request to show a tab that is not in the shared tab set", () => {
      const { view, commands } = rig();
      view.activate({ id: "a", projectId: GLOBAL });
      commands.showTab("gone");
      expect(view.getActiveTabId()).toBe("a");
    });

    it("closes and renames tabs through the host", async () => {
      const { fixture, commands } = rig();
      await commands.closeTab("a");
      await commands.renameTab("a", "Notes");
      await commands.renameTab("a", null);
      expect(fixture.commands).toEqual([
        { name: "closeTab", sessionId: "a" },
        { name: "renameSession", sessionId: "a", label: "Notes" },
        { name: "renameSession", sessionId: "a", label: null },
      ]);
    });

    it("replaces a tab's session and shows the replacement in the tab's own scope", async () => {
      const { fixture, view, commands } = rig({
        onCommand: () => ({ ok: true, value: { sessionId: "p2" } }),
      });
      const result = await commands.replaceTab("p", {
        backendId: "claude",
        preserveChatInput: true,
      });
      expect(result.ok).toBe(true);
      expect(fixture.commands).toEqual([
        { name: "replaceSession", sessionId: "p", backendId: "claude", preserveChatInput: true },
      ]);
      expect(view.getState()).toEqual({ activeTabId: "p2", projectScope: "proj" });
    });

    it("keeps the shown tab when replacing fails", async () => {
      const { view, commands } = rig({
        onCommand: () => ({ ok: false, code: "unknown_session", message: "No session" }),
      });
      view.activate({ id: "a", projectId: GLOBAL });
      await commands.replaceTab("a");
      expect(view.getActiveTabId()).toBe("a");
    });
  });
});

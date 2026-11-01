import SessionsSidebarView from "@/agentMode/ui/SessionsSidebarView";
import { SESSIONS_SIDEBAR_VIEWTYPE } from "@/constants";
import type CopilotPlugin from "@/main";
import { act, screen } from "@testing-library/react";
import type { WorkspaceLeaf } from "obsidian";

jest.mock("@/agentMode/ui/SessionsSidebar", () => ({
  SessionsSidebar: () =>
    jest
      .requireActual<typeof import("react")>("react")
      .createElement("button", { type: "button" }, "Sidebar content"),
}));

function makeView(agentSessionManager: object | undefined) {
  const plugin = { app: {}, agentSessionManager } as unknown as CopilotPlugin;
  const leaf = { app: plugin.app } as unknown as WorkspaceLeaf;
  const view = new SessionsSidebarView(leaf, plugin);
  const stopMigrationWatch = jest.fn();
  view.containerEl.onWindowMigrated = jest.fn(() => stopMigrationWatch);
  document.body.appendChild(view.containerEl);
  return { view, stopMigrationWatch };
}

describe("SessionsSidebarView", () => {
  describe("SessionsSidebarView", () => {
    it("identifies itself with the sessions sidebar view type for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", () => {
      const { view } = makeView({});

      expect(view.getViewType()).toBe(SESSIONS_SIDEBAR_VIEWTYPE);
      expect(view.getDisplayText()).toBe("Copilot Navigator");
      expect(view.getIcon()).toBe("panel-left");
    });

    it("renders the sessions sidebar when it opens and removes it when it closes for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", async () => {
      const { view, stopMigrationWatch } = makeView({});

      await act(() => view.onOpen());
      expect(await screen.findByRole("button", { name: "Sidebar content" })).toBeTruthy();

      await act(() => view.onClose());
      expect(screen.queryByRole("button", { name: "Sidebar content" })).toBeNull();
      expect(stopMigrationWatch).toHaveBeenCalledTimes(1);
    });

    it("renders nothing while Agent Chat has no session manager for https://github.com/Brevilabs/obsidian-copilot-private/issues/801", async () => {
      const { view } = makeView(undefined);

      await act(() => view.onOpen());

      expect(screen.queryByRole("button")).toBeNull();
      await act(() => view.onClose());
    });
  });
});

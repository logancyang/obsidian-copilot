import SessionsSidebarView from "@/agentMode/ui/SessionsSidebarView";
import { SESSIONS_SIDEBAR_VIEWTYPE } from "@/constants";
import type CopilotPlugin from "@/main";
import { setSettings } from "@/settings/model";
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
    beforeEach(() => setSettings({ isPaidUser: true }));

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

    it("shows only the Plus-only notice and upgrade button instead of the Navigator list for a user without Plus for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", async () => {
      setSettings({ isPaidUser: false });
      const { view } = makeView({});

      await act(() => view.onOpen());

      expect(await screen.findByText("Copilot Navigator is for Plus users only")).toBeTruthy();
      expect(screen.getByRole("button", { name: /Upgrade to Plus/ })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Sidebar content" })).toBeNull();
      await act(() => view.onClose());
    });

    it("keeps the Navigator list while entitlement is unknown so a Plus user never sees the notice flash for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", async () => {
      setSettings({ isPaidUser: undefined });
      const { view } = makeView({});

      await act(() => view.onOpen());

      expect(await screen.findByRole("button", { name: "Sidebar content" })).toBeTruthy();
      expect(screen.queryByText("Copilot Navigator is for Plus users only")).toBeNull();
      await act(() => view.onClose());
    });

    it("swaps between the notice and the Navigator list as Plus is lost and regained without a reload for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", async () => {
      const { view } = makeView({});
      await act(() => view.onOpen());
      expect(await screen.findByRole("button", { name: "Sidebar content" })).toBeTruthy();

      act(() => setSettings({ isPaidUser: false }));
      expect(screen.getByText("Copilot Navigator is for Plus users only")).toBeTruthy();

      act(() => setSettings({ isPaidUser: true }));
      expect(screen.getByRole("button", { name: "Sidebar content" })).toBeTruthy();
      await act(() => view.onClose());
    });
  });
});

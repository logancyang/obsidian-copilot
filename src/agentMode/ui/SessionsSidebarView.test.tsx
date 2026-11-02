import SessionsSidebarView from "@/agentMode/ui/SessionsSidebarView";
import { SESSIONS_SIDEBAR_VIEWTYPE } from "@/constants";
import type CopilotPlugin from "@/main";
import { setSettings } from "@/settings/model";
import { act, fireEvent, screen } from "@testing-library/react";
import type { WorkspaceLeaf } from "obsidian";

jest.mock("@/agentMode/ui/SessionsSidebar", () => ({
  SessionsSidebar: () =>
    jest
      .requireActual<typeof import("react")>("react")
      .createElement("button", { type: "button" }, "Sidebar content"),
}));

function makeView(agentSessionManager: object | undefined) {
  const plugin = {
    app: {},
    agentSessionManager,
    activateSessionsSidebar: jest.fn().mockResolvedValue(undefined),
    register: jest.fn(),
  } as unknown as CopilotPlugin;
  const leaf = { app: plugin.app, detach: jest.fn() } as unknown as WorkspaceLeaf;
  const view = new SessionsSidebarView(leaf, plugin);
  const stopMigrationWatch = jest.fn();
  view.containerEl.onWindowMigrated = jest.fn(() => stopMigrationWatch);
  document.body.appendChild(view.containerEl);
  return { view, plugin, leaf, stopMigrationWatch };
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

    it("shows only the subscription-ended notice instead of the Navigator list for a user without Plus for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      setSettings({ isPaidUser: false });
      const { view } = makeView({});

      await act(() => view.onOpen());

      expect(await screen.findByText("Your Copilot Plus subscription ended")).toBeTruthy();
      expect(screen.getByRole("button", { name: /Renew Plus/ })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Sidebar content" })).toBeNull();
      await act(() => view.onClose());
    });

    it("closes its own leaf from the notice's Close button for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      setSettings({ isPaidUser: false });
      const { view, leaf } = makeView({});
      await act(() => view.onOpen());

      fireEvent.click(await screen.findByRole("button", { name: "Close" }));

      expect(leaf.detach).toHaveBeenCalledTimes(1);
      await act(() => view.onClose());
    });

    it("reveals the Navigator when Plus becomes active after the notice was shown for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      setSettings({ isPaidUser: false });
      const { view, plugin } = makeView({});
      await act(() => view.onOpen());
      await screen.findByText("Your Copilot Plus subscription ended");

      act(() => setSettings({ isPaidUser: true }));

      expect(screen.getByRole("button", { name: "Sidebar content" })).toBeTruthy();
      expect(plugin.activateSessionsSidebar).toHaveBeenCalledTimes(1);
      await act(() => view.onClose());
    });

    it("never reveals the Navigator on Plus activation for a user who was not shown the notice for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      setSettings({ isPaidUser: undefined });
      const { view, plugin } = makeView({});
      await act(() => view.onOpen());
      await screen.findByRole("button", { name: "Sidebar content" });

      act(() => setSettings({ isPaidUser: true }));

      expect(plugin.activateSessionsSidebar).not.toHaveBeenCalled();
      await act(() => view.onClose());
    });

    it("keeps the Navigator list while entitlement is unknown so a Plus user never sees the notice flash for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", async () => {
      setSettings({ isPaidUser: undefined });
      const { view } = makeView({});

      await act(() => view.onOpen());

      expect(await screen.findByRole("button", { name: "Sidebar content" })).toBeTruthy();
      expect(screen.queryByText("Your Copilot Plus subscription ended")).toBeNull();
      await act(() => view.onClose());
    });

    it("swaps between the notice and the Navigator list as Plus is lost and regained without a reload for https://github.com/Brevilabs/obsidian-copilot-private/issues/813", async () => {
      const { view } = makeView({});
      await act(() => view.onOpen());
      expect(await screen.findByRole("button", { name: "Sidebar content" })).toBeTruthy();

      act(() => setSettings({ isPaidUser: false }));
      expect(screen.getByText("Your Copilot Plus subscription ended")).toBeTruthy();

      act(() => setSettings({ isPaidUser: true }));
      expect(screen.getByRole("button", { name: "Sidebar content" })).toBeTruthy();
      await act(() => view.onClose());
    });
  });
});

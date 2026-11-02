import SessionsSidebarView from "@/agentMode/ui/SessionsSidebarView";
import { SESSIONS_SIDEBAR_VIEWTYPE } from "@/constants";
import type CopilotPlugin from "@/main";
import {
  applyLicenseWithPreview,
  setPreviewAccess,
  verifyStoredToken,
} from "@/agentMode/ui/testing/previewAccess";
import { act, fireEvent, screen } from "@testing-library/react";
import type { WorkspaceLeaf } from "obsidian";

jest.mock("@/entitlement");

const mockSidebarMounts = jest.fn();
jest.mock("@/agentMode/ui/SessionsSidebar", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    SessionsSidebar: () => {
      React.useEffect(() => mockSidebarMounts(), []);
      return React.createElement("button", { type: "button" }, "Sidebar content");
    },
  };
});

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
    beforeEach(async () => {
      mockSidebarMounts.mockClear();
      await setPreviewAccess("believer");
    });

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

    it("shows only the preview notice instead of the Navigator list for a Plus user without preview for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setPreviewAccess("plus-without-preview");
      const { view } = makeView({});

      await act(() => view.onOpen());

      expect(await screen.findByText("Your preview access ended")).toBeTruthy();
      expect(screen.getByRole("button", { name: /See plans/ })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Sidebar content" })).toBeNull();
      await act(() => view.onClose());
    });

    it("closes its own leaf from the notice's Close button for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setPreviewAccess("free");
      const { view, leaf } = makeView({});
      await act(() => view.onOpen());

      fireEvent.click(await screen.findByRole("button", { name: "Close" }));

      expect(leaf.detach).toHaveBeenCalledTimes(1);
      await act(() => view.onClose());
    });

    it("reveals the Navigator when a license key with preview is applied after the notice was shown for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setPreviewAccess("free");
      const { view, plugin } = makeView({});
      await act(() => view.onOpen());
      await screen.findByText("Your preview access ended");

      await act(() => applyLicenseWithPreview());

      expect(screen.getByRole("button", { name: "Sidebar content" })).toBeTruthy();
      expect(plugin.activateSessionsSidebar).toHaveBeenCalledTimes(1);
      await act(() => view.onClose());
    });

    it("keeps a Believer's restored Navigator list mounted through startup verification, without flashing the notice or reopening it, for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setPreviewAccess("unverified");
      const { view, plugin } = makeView({});
      await act(() => view.onOpen());
      await screen.findByRole("button", { name: "Sidebar content" });

      await act(() => verifyStoredToken(true));

      expect(screen.getByRole("button", { name: "Sidebar content" })).toBeTruthy();
      expect(screen.queryByText("Your preview access ended")).toBeNull();
      expect(mockSidebarMounts).toHaveBeenCalledTimes(1);
      expect(plugin.activateSessionsSidebar).not.toHaveBeenCalled();
      await act(() => view.onClose());
    });

    it("shows the notice once startup verification finds no preview access for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setPreviewAccess("unverified");
      const { view } = makeView({});
      await act(() => view.onOpen());
      await screen.findByRole("button", { name: "Sidebar content" });

      await act(() => verifyStoredToken(false));

      expect(screen.getByText("Your preview access ended")).toBeTruthy();
      await act(() => view.onClose());
    });
  });
});

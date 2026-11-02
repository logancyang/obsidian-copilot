import {
  AgentHomeNavigatorCard,
  NavigatorHomeCard,
  useNavigatorHomeCardVisible,
} from "@/agentMode/ui/NavigatorHomeCard";
import { NavigatorUpsellModal } from "@/agentMode/ui/NavigatorUpsell";
import { makeFakeWorkspaceApp } from "@/agentMode/ui/testing/fakeWorkspaceApp";
import { SESSIONS_SIDEBAR_VIEWTYPE } from "@/constants";
import type CopilotPlugin from "@/main";
import { getSettings, setSettings } from "@/settings/model";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import React from "react";

const mockOpenUpsell = jest.fn();
jest.mock("@/agentMode/ui/NavigatorUpsell", () => ({
  NavigatorUpsellModal: jest.fn(() => ({ open: mockOpenUpsell })),
}));

function makePlugin(): CopilotPlugin {
  return {
    app: {},
    activateSessionsSidebar: jest.fn().mockResolvedValue(undefined),
  } as unknown as CopilotPlugin;
}

describe("NavigatorHomeCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setSettings({ isPaidUser: true, navigatorHomeCardDismissed: false });
  });

  describe("NavigatorHomeCard()", () => {
    it("announces Copilot Navigator with one line on what it does and an Open Copilot Navigator action", () => {
      const onOpen = jest.fn();
      render(<NavigatorHomeCard showPlusMarker={false} onOpen={onOpen} onDismiss={jest.fn()} />);

      expect(screen.getByRole("region", { name: "New: Copilot Navigator" })).toBeTruthy();
      expect(screen.getByText(/Keep every agent chat in one sidebar/)).toBeTruthy();
      expect(screen.queryByText("Plus")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Open Copilot Navigator" }));
      expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it("carries a Plus marker when asked so the paywall is never a surprise for https://github.com/Brevilabs/obsidian-copilot-private/issues/821", () => {
      render(<NavigatorHomeCard showPlusMarker onOpen={jest.fn()} onDismiss={jest.fn()} />);

      expect(screen.getByText("Plus")).toBeTruthy();
    });

    it("calls onDismiss from its close button", () => {
      const onDismiss = jest.fn();
      render(<NavigatorHomeCard showPlusMarker={false} onOpen={jest.fn()} onDismiss={onDismiss} />);

      fireEvent.click(screen.getByRole("button", { name: /Dismiss/ }));

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe("useNavigatorHomeCardVisible()", () => {
    it("is true by default while the Navigator is closed", () => {
      const fake = makeFakeWorkspaceApp();

      const { result } = renderHook(() => useNavigatorHomeCardVisible(fake.app));

      expect(result.current).toBe(true);
    });

    it("is false once the card was dismissed, which settings sync to every device, for https://github.com/Brevilabs/obsidian-copilot-private/issues/821", () => {
      setSettings({ navigatorHomeCardDismissed: true });
      const fake = makeFakeWorkspaceApp();

      const { result } = renderHook(() => useNavigatorHomeCardVisible(fake.app));

      expect(result.current).toBe(false);
    });

    it("is false while the Navigator is open and true again when it closes for https://github.com/Brevilabs/obsidian-copilot-private/issues/821", () => {
      const fake = makeFakeWorkspaceApp();
      const { result } = renderHook(() => useNavigatorHomeCardVisible(fake.app));

      act(() => fake.setLeaves({ [SESSIONS_SIDEBAR_VIEWTYPE]: 1 }));
      expect(result.current).toBe(false);

      act(() => fake.setLeaves({}));
      expect(result.current).toBe(true);
    });
  });

  describe("AgentHomeNavigatorCard()", () => {
    it("opens the Navigator for a Plus user and hides the card for good for https://github.com/Brevilabs/obsidian-copilot-private/issues/821", () => {
      const plugin = makePlugin();
      render(<AgentHomeNavigatorCard plugin={plugin} />);
      expect(screen.queryByText("Plus")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Open Copilot Navigator" }));

      expect(plugin.activateSessionsSidebar).toHaveBeenCalledTimes(1);
      expect(mockOpenUpsell).not.toHaveBeenCalled();
      expect(getSettings().navigatorHomeCardDismissed).toBe(true);
    });

    it("shows the Plus marker and opens the upgrade dialog for a user without Plus, hiding the card for good, for https://github.com/Brevilabs/obsidian-copilot-private/issues/821", () => {
      setSettings({ isPaidUser: false });
      const plugin = makePlugin();
      render(<AgentHomeNavigatorCard plugin={plugin} />);
      expect(screen.getByText("Plus")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Open Copilot Navigator" }));

      expect(NavigatorUpsellModal).toHaveBeenCalledWith(plugin.app);
      expect(mockOpenUpsell).toHaveBeenCalledTimes(1);
      expect(plugin.activateSessionsSidebar).not.toHaveBeenCalled();
      expect(getSettings().navigatorHomeCardDismissed).toBe(true);
    });

    it("saves the dismissal from the close button without opening anything for https://github.com/Brevilabs/obsidian-copilot-private/issues/821", () => {
      const plugin = makePlugin();
      render(<AgentHomeNavigatorCard plugin={plugin} />);

      fireEvent.click(screen.getByRole("button", { name: /Dismiss/ }));

      expect(getSettings().navigatorHomeCardDismissed).toBe(true);
      expect(plugin.activateSessionsSidebar).not.toHaveBeenCalled();
      expect(mockOpenUpsell).not.toHaveBeenCalled();
    });
  });
});

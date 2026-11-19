import {
  dismissFirstAgentBanner,
  FirstAgentBanner,
  useFirstAgentBannerVisible,
} from "@/agents/ui/FirstAgentBanner";
import { getSettings, resetSettings, sanitizeSettings, setSettings } from "@/settings/model";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import React from "react";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/939";

describe("FirstAgentBanner", () => {
  beforeEach(() => resetSettings());

  describe("FirstAgentBanner()", () => {
    it("explains custom agents and opens the create dialog from Create your first agent", () => {
      const onCreate = jest.fn();
      render(<FirstAgentBanner onCreate={onCreate} onDismiss={jest.fn()} />);

      expect(screen.getByText("Give each job its own agent")).not.toBeNull();
      expect(
        screen.getByText("An agent has its own instructions and remembers the rules you give it.")
      ).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Create your first agent" }));

      expect(onCreate).toHaveBeenCalledTimes(1);
    });

    it("dismisses itself from its close button", () => {
      const onDismiss = jest.fn();
      render(<FirstAgentBanner onCreate={jest.fn()} onDismiss={onDismiss} />);

      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe("useFirstAgentBannerVisible()", () => {
    it("shows the banner while there are no agents and hides it once one exists", () => {
      const { result, rerender } = renderHook(({ count }) => useFirstAgentBannerVisible(count), {
        initialProps: { count: 0 },
      });
      expect(result.current).toBe(true);

      rerender({ count: 1 });

      expect(result.current).toBe(false);
    });

    it(`keeps the banner away after the first agent is deleted again (${ISSUE})`, () => {
      const { result, rerender } = renderHook(({ count }) => useFirstAgentBannerVisible(count), {
        initialProps: { count: 1 },
      });

      rerender({ count: 0 });

      expect(result.current).toBe(false);
      expect(getSettings().agentMode.firstAgentBannerDismissed).toBe(true);
    });

    it(`hides the banner for good once it is dismissed, even after the settings are loaded again (${ISSUE})`, () => {
      const { result } = renderHook(() => useFirstAgentBannerVisible(0));

      act(() => dismissFirstAgentBanner());
      expect(result.current).toBe(false);

      act(() => setSettings(sanitizeSettings(getSettings())));
      expect(result.current).toBe(false);
      expect(getSettings().agentMode.firstAgentBannerDismissed).toBe(true);
    });
  });

  describe("dismissFirstAgentBanner()", () => {
    it("records the dismissal in the settings", () => {
      dismissFirstAgentBanner();

      expect(getSettings().agentMode.firstAgentBannerDismissed).toBe(true);
    });
  });
});

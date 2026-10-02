import { AgentHomePreviewBadge } from "@/agentMode/ui/AgentHomePreviewBadge";
import { AppContext } from "@/context";
import { useIsPreviewEnabled } from "@/plusUtils";
import { openCopilotSettings } from "@/settings/openSettings";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "obsidian";
import * as React from "react";

jest.mock("@/plusUtils", () => ({
  useIsPreviewEnabled: jest.fn(),
}));
jest.mock("@/settings/openSettings", () => ({
  openCopilotSettings: jest.fn(),
}));

const BADGE_NAME = "Copilot Preview is on. Open the release channel switch.";

function renderBadge(app: App, visible: boolean) {
  return render(
    <AppContext.Provider value={app}>
      <AgentHomePreviewBadge visible={visible} />
    </AppContext.Provider>
  );
}

describe("AgentHomePreviewBadge", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("AgentHomePreviewBadge()", () => {
    it("opens Copilot settings, where the switch lives, when clicked", () => {
      jest.mocked(useIsPreviewEnabled).mockReturnValue(true);
      const app = new App();
      renderBadge(app, true);

      const badge = screen.getByRole("button", { name: BADGE_NAME });
      Object.defineProperty(badge, "win", { value: window });
      fireEvent.click(badge);

      expect(badge.textContent).toBe("Preview");
      expect(openCopilotSettings).toHaveBeenCalledWith(app, window, "basic");
    });

    it("hides while Copilot runs as Official", () => {
      jest.mocked(useIsPreviewEnabled).mockReturnValue(false);

      renderBadge(new App(), true);

      expect(screen.queryByRole("button", { name: BADGE_NAME })).toBeNull();
    });

    it("hides away from the global Agent home landing", () => {
      jest.mocked(useIsPreviewEnabled).mockReturnValue(true);

      renderBadge(new App(), false);

      expect(screen.queryByRole("button", { name: BADGE_NAME })).toBeNull();
    });
  });
});

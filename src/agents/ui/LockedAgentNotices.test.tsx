import {
  LockedHomeNote,
  LockedProfileBanner,
  unlockCustomAgents,
} from "@/agents/ui/LockedAgentNotices";
import { openCopilotSettings } from "@/settings/openSettings";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

jest.mock("@/settings/openSettings", () => ({ openCopilotSettings: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/950";

describe("LockedAgentNotices", () => {
  let open: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    open = jest.spyOn(window, "open").mockReturnValue(null);
  });

  afterEach(() => open.mockRestore());

  describe("unlockCustomAgents()", () => {
    it(`opens the pricing page tagged custom_agent_renew for a lapsed license (${ISSUE})`, () => {
      unlockCustomAgents(new App(), true, window);

      const [url] = open.mock.calls[0] as [string];
      expect(url).toContain("https://www.obsidiancopilot.com/pricing");
      expect(new URL(url).searchParams.get("utm_medium")).toBe("custom_agent_renew");
      expect(openCopilotSettings).not.toHaveBeenCalled();
    });

    it(`opens the Copilot settings tab holding the license key field on a device that never had a license (${ISSUE})`, () => {
      const app = new App();

      unlockCustomAgents(app, false, window);

      expect(openCopilotSettings).toHaveBeenCalledWith(app, window, "basic");
      expect(open).not.toHaveBeenCalled();
    });
  });

  describe("LockedProfileBanner()", () => {
    it(`says a lapsed plan ended and the agent can't chat until renewed, with Renew (${ISSUE})`, () => {
      const onUnlock = jest.fn();
      render(<LockedProfileBanner name="Maya" lapsed onUnlock={onUnlock} />);

      expect(
        screen.getByText("Your Supporter plan ended. Maya can't chat until you renew.")
      ).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Renew" }));

      expect(onUnlock).toHaveBeenCalledTimes(1);
    });

    it(`asks for a Supporter license key on a device without an active paid plan (${ISSUE})`, () => {
      const onUnlock = jest.fn();
      render(<LockedProfileBanner name="Maya" lapsed={false} onUnlock={onUnlock} />);

      expect(
        screen.getByText("Maya can't chat until you enter a Supporter license key on this device.")
      ).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Enter license key" }));

      expect(onUnlock).toHaveBeenCalledTimes(1);
    });
  });

  describe("LockedHomeNote()", () => {
    it(`says a lapsed plan ended and the agents are still here, with Renew (${ISSUE})`, () => {
      const onUnlock = jest.fn();
      const { container } = render(<LockedHomeNote lapsed onUnlock={onUnlock} />);

      expect(container.textContent).toBe(
        "Your Supporter plan ended. Your agents and their files are still here. Renew"
      );
      fireEvent.click(screen.getByRole("button", { name: "Renew" }));

      expect(onUnlock).toHaveBeenCalledTimes(1);
    });

    it(`asks for a Supporter license key on a device without an active paid plan (${ISSUE})`, () => {
      const onUnlock = jest.fn();
      const { container } = render(<LockedHomeNote lapsed={false} onUnlock={onUnlock} />);

      expect(container.textContent).toBe(
        "This vault's agents can't chat until you enter a Supporter license key on this device. Enter license key"
      );
      fireEvent.click(screen.getByRole("button", { name: "Enter license key" }));

      expect(onUnlock).toHaveBeenCalledTimes(1);
    });
  });
});

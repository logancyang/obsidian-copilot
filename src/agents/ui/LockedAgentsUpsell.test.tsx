import {
  LockedAgentsUpsellContent,
  LockedAgentsUpsellModal,
  lockedAgentsTitle,
} from "@/agents/ui/LockedAgentsUpsell";
import { COCO, LEO, MAYA, NORA } from "@/agents/ui/testing/rosterFixtures";
import { AppContext } from "@/context";
import { resetSettings, setSettings } from "@/settings/model";
import { openCopilotSettings } from "@/settings/openSettings";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

jest.mock("@/settings/openSettings", () => ({ openCopilotSettings: jest.fn() }));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/950";
const FOUR = [COCO, MAYA, LEO, NORA];

function renderContent(props: { lapsed: boolean; agents?: typeof FOUR }) {
  const onClose = jest.fn();
  const app = new App();
  render(
    <AppContext.Provider value={app}>
      <LockedAgentsUpsellContent
        agents={props.agents ?? FOUR}
        lapsed={props.lapsed}
        onClose={onClose}
      />
    </AppContext.Provider>
  );
  return { app, onClose };
}

function buttonNames(): string[] {
  return screen.getAllByRole("button").map((button) => button.textContent?.trim() ?? "");
}

describe("LockedAgentsUpsell", () => {
  let open: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    resetSettings();
    open = jest.spyOn(window, "open").mockReturnValue(null);
  });

  afterEach(() => open.mockRestore());

  describe("lockedAgentsTitle()", () => {
    it(`tells a lapsed Supporter their agents are still here and a device without a license how many agents the vault has (${ISSUE})`, () => {
      expect(lockedAgentsTitle(4, true)).toBe("Your agents are still here");
      expect(lockedAgentsTitle(4, false)).toBe("This vault has 4 custom agents");
      expect(lockedAgentsTitle(1, false)).toBe("This vault has 1 custom agent");
    });
  });

  describe("LockedAgentsUpsellContent()", () => {
    it(`shows a lapsed Supporter their own faces, what they keep, and Enter license key beside Renew (${ISSUE})`, () => {
      renderContent({ lapsed: true });

      expect(
        screen.getAllByRole("img", { hidden: true }).map((img) => img.getAttribute("src"))
      ).toEqual(FOUR.map((agent) => agent.faceSrc));
      expect(
        screen.getByText(
          "Coco, Maya, Leo and Nora still have their instructions and memory. Your Supporter plan ended, so you can read past chats but can't start new ones."
        )
      ).not.toBeNull();
      expect(screen.getByText("Renew to talk to them again.")).not.toBeNull();
      expect(buttonNames()).toEqual(["Enter license key", "Renew"]);
    });

    it(`names the one agent a lapsed Supporter has (${ISSUE})`, () => {
      renderContent({ lapsed: true, agents: [MAYA] });

      expect(
        screen.getByText(
          "Maya still has their instructions and memory. Your Supporter plan ended, so you can read past chats but can't start new ones."
        )
      ).not.toBeNull();
      expect(screen.getByText("Renew to talk to Maya again.")).not.toBeNull();
    });

    it(`opens the pricing page tagged custom_agent_renew from Renew and closes (${ISSUE})`, () => {
      const { onClose } = renderContent({ lapsed: true });

      fireEvent.click(screen.getByRole("button", { name: "Renew" }));

      const [url] = open.mock.calls[0] as [string];
      expect(url).toContain("https://www.obsidiancopilot.com/pricing");
      expect(new URL(url).searchParams.get("utm_medium")).toBe("custom_agent_renew");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it(`leads a device that never had a license with Enter license key, after See plans, and says the files in the agents folder stay as they are (${ISSUE})`, () => {
      setSettings({ copilotFolder: "Tools/My Copilot" });
      const { app, onClose } = renderContent({ lapsed: false });

      expect(
        screen.getByText(
          "They were set up with a Supporter license on another device. To talk to them here, enter your license key on this device too."
        )
      ).not.toBeNull();
      expect(screen.getByText("Tools/My Copilot/agents").tagName).toBe("CODE");
      expect(buttonNames()).toEqual(["See plans", "Enter license key"]);
      expect(screen.getByRole("button", { name: "Enter license key" }).className).toContain(
        "mod-cta"
      );

      fireEvent.click(screen.getByRole("button", { name: "Enter license key" }));

      expect(openCopilotSettings).toHaveBeenCalledWith(app, window, "basic");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it(`names the one agent a device without a license has (${ISSUE})`, () => {
      renderContent({ lapsed: false, agents: [MAYA] });
      const container = document.body;

      expect(
        screen.getByText(
          "Maya was set up with a Supporter license on another device. To talk to Maya here, enter your license key on this device too."
        )
      ).not.toBeNull();
      expect(container.textContent).toContain("Maya's files in copilot/agents stay as they are.");
    });

    it(`opens the pricing page tagged custom_agent_synced from See plans on a device that never had a license (${ISSUE})`, () => {
      const { onClose } = renderContent({ lapsed: false });

      fireEvent.click(screen.getByRole("button", { name: "See plans" }));

      const [url] = open.mock.calls[0] as [string];
      expect(new URL(url).searchParams.get("utm_medium")).toBe("custom_agent_synced");
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("LockedAgentsUpsellModal", () => {
    describe("constructor()", () => {
      it.each([
        { device: "a lapsed device", key: "lapsed-key", title: "Your agents are still here" },
        {
          device: "a device that never had a license",
          key: "",
          title: "This vault has 4 custom agents",
        },
      ])(`titles the dialog for $device by its stored license key (${ISSUE})`, ({ key, title }) => {
        setSettings({ plusLicenseKey: key });

        const modal = new LockedAgentsUpsellModal(new App(), FOUR);

        expect(modal.titleEl.textContent).toBe(title);
      });
    });
  });
});

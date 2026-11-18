import {
  LockedAgentChat,
  LockedHomeNote,
  LockedProfileBanner,
  SetupLockedProfileBanner,
  unlockCustomAgents,
  useReadOnlyChatAgent,
} from "@/agents/ui/LockedAgentNotices";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { setCustomAgentsAccess } from "@/agents/testing/customAgentsAccess";
import { setCustomAgentsLaunched } from "@/agents/testing/customAgentsLaunched";
import { openCopilotSettings } from "@/settings/openSettings";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { App } from "obsidian";
import React from "react";

jest.mock("@/settings/openSettings", () => ({ openCopilotSettings: jest.fn() }));
jest.mock("@/entitlement");

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/950";
const SETUP_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/962";
const OPENCODE_REASON = "Coco runs on OpenCode, which isn't set up on this device.";
const COCO = { slug: "coco", name: "Coco" } as CustomAgent;

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

  describe("LockedAgentChat()", () => {
    it(`stands in for the chat input with a note that the chat is read-only, New Copilot chat and Renew on a lapsed device (${ISSUE})`, () => {
      const onNewChat = jest.fn();
      const onUnlock = jest.fn();
      render(<LockedAgentChat name="Coco" lapsed onNewChat={onNewChat} onUnlock={onUnlock} />);

      expect(
        screen.getByText("Your Supporter plan ended. You can read this chat, but Coco can't reply.")
      ).not.toBeNull();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
        "New Copilot chat",
        "Renew",
      ]);

      fireEvent.click(screen.getByRole("button", { name: "New Copilot chat" }));
      fireEvent.click(screen.getByRole("button", { name: "Renew" }));

      expect(onNewChat).toHaveBeenCalledTimes(1);
      expect(onUnlock).toHaveBeenCalledTimes(1);
    });

    it(`offers Enter license key instead of Renew on a device without an active paid plan (${ISSUE})`, () => {
      const onUnlock = jest.fn();
      render(
        <LockedAgentChat name="Coco" lapsed={false} onNewChat={jest.fn()} onUnlock={onUnlock} />
      );

      expect(
        screen.getByText(
          "You can read this chat, but Coco can't reply until you enter a Supporter license key on this device."
        )
      ).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Enter license key" }));

      expect(onUnlock).toHaveBeenCalledTimes(1);
    });

    it(`gives the setup reason and the way to the agent's profile when the agent's model can't run on this device (${SETUP_ISSUE})`, () => {
      const onNewChat = jest.fn();
      const onOpenProfile = jest.fn();
      render(
        <LockedAgentChat
          name="Coco"
          lapsed={false}
          onNewChat={onNewChat}
          onUnlock={jest.fn()}
          setup={{ reason: OPENCODE_REASON, onOpenProfile }}
        />
      );

      expect(
        screen.getByText(`You can read this chat, but Coco can't reply. ${OPENCODE_REASON}`)
      ).not.toBeNull();
      expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
        "New Copilot chat",
        "Open Coco's profile",
      ]);
      fireEvent.click(screen.getByRole("button", { name: "Open Coco's profile" }));
      fireEvent.click(screen.getByRole("button", { name: "New Copilot chat" }));

      expect(onOpenProfile).toHaveBeenCalledTimes(1);
      expect(onNewChat).toHaveBeenCalledTimes(1);
    });
  });

  describe("SetupLockedProfileBanner()", () => {
    it(`states the reason with the coding agent's setup when that is what's missing (${SETUP_ISSUE})`, () => {
      const open = jest.fn();
      render(
        <SetupLockedProfileBanner
          reason={OPENCODE_REASON}
          setUp={{ label: "Set up OpenCode", open }}
        />
      );

      expect(screen.getByText(OPENCODE_REASON)).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Set up OpenCode" }));

      expect(open).toHaveBeenCalledTimes(1);
    });

    it(`states the reason alone when only the model needs changing (${SETUP_ISSUE})`, () => {
      render(<SetupLockedProfileBanner reason="Coco's model, gpt-6, isn't available." />);

      expect(screen.queryByRole("button")).toBeNull();
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

  describe("useReadOnlyChatAgent()", () => {
    it(`makes an idle agent chat read-only while custom agents are locked, and gives the chat input back once a license unlocks them, without a reload (${ISSUE})`, async () => {
      await setCustomAgentsAccess("team");
      const { result } = renderHook(() => useReadOnlyChatAgent(COCO, false, false));
      expect(result.current).toBeNull();

      setCustomAgentsLaunched(true);
      await act(() => setCustomAgentsAccess("free"));
      expect(result.current).toBe(COCO);

      await act(() => setCustomAgentsAccess("team"));
      expect(result.current).toBeNull();
    });

    it(`keeps the chat input while a turn that started before the lapse is still running (${ISSUE})`, async () => {
      setCustomAgentsLaunched(true);
      await setCustomAgentsAccess("free");

      const { result, rerender } = renderHook(
        ({ running }: { running: boolean }) => useReadOnlyChatAgent(COCO, running, false),
        { initialProps: { running: true } }
      );
      expect(result.current).toBeNull();

      rerender({ running: false });
      expect(result.current).toBe(COCO);
    });

    it(`makes an idle chat read-only while its agent's model can't run on this device, and gives the input back once that's fixed (${SETUP_ISSUE})`, async () => {
      await setCustomAgentsAccess("team");
      const { result, rerender } = renderHook(
        ({ needsSetup, running }: { needsSetup: boolean; running: boolean }) =>
          useReadOnlyChatAgent(COCO, running, needsSetup),
        { initialProps: { needsSetup: true, running: true } }
      );
      expect(result.current).toBeNull();

      rerender({ needsSetup: true, running: false });
      expect(result.current).toBe(COCO);

      rerender({ needsSetup: false, running: false });
      expect(result.current).toBeNull();
    });

    it(`never makes a Copilot chat read-only (${ISSUE})`, async () => {
      setCustomAgentsLaunched(true);
      await setCustomAgentsAccess("free");

      const { result } = renderHook(() => useReadOnlyChatAgent(null, false, true));

      expect(result.current).toBeNull();
    });
  });
});

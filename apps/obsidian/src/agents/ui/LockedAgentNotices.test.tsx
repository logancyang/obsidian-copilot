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
    it(`opens the Copilot settings tab holding the license key field, whether the stored key is not valid or none was entered (${ISSUE})`, () => {
      const app = new App();

      unlockCustomAgents(app, window);

      expect(openCopilotSettings).toHaveBeenCalledWith(app, window, "basic");
      expect(open).not.toHaveBeenCalled();
    });
  });

  describe("LockedProfileBanner()", () => {
    it(`says the agent can't chat without a valid Supporter license, with Enter license key (${ISSUE})`, () => {
      const onUnlock = jest.fn();
      render(<LockedProfileBanner name="Maya" onUnlock={onUnlock} />);

      expect(screen.getByText("Maya can't chat without a valid Supporter license.")).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Enter license key" }));

      expect(onUnlock).toHaveBeenCalledTimes(1);
    });
  });

  describe("LockedAgentChat()", () => {
    it(`stands in for the chat input with a note that the chat is read-only without a valid Supporter license, New Copilot chat and Enter license key (${ISSUE})`, () => {
      const onNewChat = jest.fn();
      const onUnlock = jest.fn();
      render(<LockedAgentChat name="Coco" onNewChat={onNewChat} onUnlock={onUnlock} />);

      expect(
        screen.getByText(
          "You can read this chat, but Coco can't reply without a valid Supporter license."
        )
      ).not.toBeNull();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
        "New Copilot chat",
        "Enter license key",
      ]);

      fireEvent.click(screen.getByRole("button", { name: "New Copilot chat" }));
      fireEvent.click(screen.getByRole("button", { name: "Enter license key" }));

      expect(onNewChat).toHaveBeenCalledTimes(1);
      expect(onUnlock).toHaveBeenCalledTimes(1);
    });

    it(`gives the setup reason and the way to the agent's profile when the agent's model can't run on this device (${SETUP_ISSUE})`, () => {
      const onNewChat = jest.fn();
      const onOpenProfile = jest.fn();
      render(
        <LockedAgentChat
          name="Coco"
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
    it(`says the agents need a valid Supporter license to chat, with Enter license key (${ISSUE})`, () => {
      const onUnlock = jest.fn();
      const { container } = render(<LockedHomeNote onUnlock={onUnlock} />);

      expect(container.textContent).toBe(
        "Your teammates need a valid Supporter license to chat. Enter license key"
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

      await act(() => setCustomAgentsAccess("free"));
      expect(result.current).toBe(COCO);

      await act(() => setCustomAgentsAccess("team"));
      expect(result.current).toBeNull();
    });

    it(`keeps the chat input while a turn that started before the license turned invalid is still running (${ISSUE})`, async () => {
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
      await setCustomAgentsAccess("free");

      const { result } = renderHook(() => useReadOnlyChatAgent(null, false, true));

      expect(result.current).toBeNull();
    });
  });
});

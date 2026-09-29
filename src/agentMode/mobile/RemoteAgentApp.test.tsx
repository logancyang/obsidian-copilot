import { RemoteAgentApp, SELECTED_DESKTOP_STORAGE_KEY } from "@/agentMode/mobile/RemoteAgentApp";
import { startRemoteRig, type RemoteRig } from "@/agentMode/mobile/remoteTestKit";
import { makeTestSession } from "@/agentMode/session/host/hostTestHarness";
import { PairedDesktopStore } from "@/remote/client/PairedDesktopStore";
import type { RemoteClient } from "@/remote/client/RemoteClient";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- module mocks keep the hook names of the modules they replace */
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ agentMode: {} }),
  useSettingsValue: () => ({ autoAddActiveContentToContext: false }),
}));
jest.mock("@/plusUtils", () => ({
  ensureMultiAgentEntitlement: jest.fn(async () => true),
  showMultiAgentUpgradePrompt: jest.fn(),
}));
jest.mock("@/agentMode/ui/AgentTabStrip", () => ({
  AgentTabStrip: () => <div data-testid="tab-strip" />,
}));
jest.mock("@/agentMode/ui/AgentChatMessages", () => ({
  __esModule: true,
  default: ({ sessionId }: { sessionId: string }) => <div data-testid="messages">{sessionId}</div>,
}));
jest.mock("@/agentMode/ui/AgentChatInput", () => ({
  AgentChatInput: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="composer">{sessionId}</div>
  ),
}));
jest.mock("@/agentMode/ui/hooks/useChatInputAutoFocus", () => ({
  useChatInputAutoFocus: () => {},
}));
jest.mock("@/agentMode/ui/hooks/useChatRuntime", () => ({ useChatRuntime: () => null }));
jest.mock("@/agentMode/ui/hooks/useTabCommands", () => ({
  useTabCommands: () => ({ createTab: jest.fn(async () => ({ ok: true })) }),
}));
jest.mock("@/context/ChatInputContext", () => ({
  ChatInputProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
jest.mock("obsidian", () => ({
  Notice: jest.fn(),
  Platform: { isDesktopApp: true, isMobile: false },
}));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/613";

function makeApp(initial: string | null = null) {
  const storage = new Map<string, string>();
  if (initial) storage.set(SELECTED_DESKTOP_STORAGE_KEY, initial);
  return {
    loadLocalStorage: (key: string) => storage.get(key) ?? null,
    saveLocalStorage: (key: string, value: string | null) => {
      if (value === null) storage.delete(key);
      else storage.set(key, value);
    },
    workspace: { getActiveFile: () => null },
    storage,
  } as unknown as App & { storage: Map<string, string> };
}

describe("RemoteAgentApp", () => {
  let rig: RemoteRig | null = null;

  afterEach(async () => {
    await rig?.stop();
    rig = null;
  });

  describe("RemoteAgentApp()", () => {
    it("points the user to the Remote settings when no desktop is paired", () => {
      const store = new PairedDesktopStore({ read: () => null, write: () => {} });
      render(
        <RemoteAgentApp
          app={makeApp()}
          remote={{ store } as unknown as RemoteClient}
          appVersion="1.0.0"
          updateUserMessageHistory={() => {}}
        />
      );

      expect(screen.getByText("No desktop paired")).not.toBeNull();
    });

    it("connects to the only paired desktop and shows the tab it shares with the desktop", async () => {
      rig = await startRemoteRig();
      rig.manager.add(makeTestSession("s1").session);

      render(
        <RemoteAgentApp
          app={makeApp()}
          remote={rig.remote}
          appVersion="test-1.0.0"
          updateUserMessageHistory={() => {}}
        />
      );

      await waitFor(() => expect(screen.getByTestId("messages").textContent).toBe("s1"));
      expect(screen.getByTestId("composer").textContent).toBe("s1");
      expect(screen.getByTestId("tab-strip")).not.toBeNull();
      expect(screen.getByText("Studio Mac")).not.toBeNull();
    });

    it("offers to start a session when the desktop has no agent tab", async () => {
      rig = await startRemoteRig();

      render(
        <RemoteAgentApp
          app={makeApp()}
          remote={rig.remote}
          appVersion="test-1.0.0"
          updateUserMessageHistory={() => {}}
        />
      );

      await waitFor(() =>
        expect(screen.getByText("No agent sessions are open on Studio Mac")).not.toBeNull()
      );
      expect(screen.getByRole("button", { name: "Start a session" })).not.toBeNull();
    });

    it(`shows the offline state and keeps retrying when the desktop stops listening (${ISSUE})`, async () => {
      rig = await startRemoteRig();
      await rig.server.close();

      render(
        <RemoteAgentApp
          app={makeApp()}
          remote={rig.remote}
          appVersion="test-1.0.0"
          updateUserMessageHistory={() => {}}
        />
      );

      await waitFor(() => expect(screen.getByText("Studio Mac is offline")).not.toBeNull(), {
        timeout: 4000,
      });
    });

    it("asks which desktop to use when several are paired and remembers the choice", async () => {
      rig = await startRemoteRig();
      const second = {
        ...rig.desktop,
        id: "desktop-2",
        host: "100.64.0.50",
        desktopName: "Laptop",
      };
      rig.remote.store.add(second);
      const app = makeApp();

      render(
        <RemoteAgentApp
          app={app}
          remote={rig.remote}
          appVersion="test-1.0.0"
          updateUserMessageHistory={() => {}}
        />
      );
      expect(screen.getByText("Choose a desktop")).not.toBeNull();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Studio Mac/ }));
      });

      expect(app.storage.get(SELECTED_DESKTOP_STORAGE_KEY)).toBe(rig.desktop.id);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Choose another desktop" })).not.toBeNull()
      );
    });

    it("opens the desktop it chose last time without asking again", async () => {
      rig = await startRemoteRig();
      rig.remote.store.add({
        ...rig.desktop,
        id: "desktop-2",
        host: "100.64.0.50",
        desktopName: "Laptop",
      });

      render(
        <RemoteAgentApp
          app={makeApp(rig.desktop.id)}
          remote={rig.remote}
          appVersion="test-1.0.0"
          updateUserMessageHistory={() => {}}
        />
      );

      expect(screen.queryByText("Choose a desktop")).toBeNull();
      await waitFor(() => expect(screen.getByText("Studio Mac")).not.toBeNull());
    });
  });
});

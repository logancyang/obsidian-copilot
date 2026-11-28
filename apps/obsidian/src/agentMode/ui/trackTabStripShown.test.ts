import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { makeFakeWorkspaceApp } from "@/agentMode/ui/testing/fakeWorkspaceApp";
import { setNavigatorAccess } from "@/agentMode/ui/testing/navigatorAccess";
import { trackTabStripShown } from "@/agentMode/ui/trackTabStripShown";
import { CHAT_AGENT_VIEWTYPE, SESSIONS_SIDEBAR_VIEWTYPE } from "@/constants";
import type { Plugin } from "obsidian";

jest.mock("@/entitlement");

function track() {
  const workspace = makeFakeWorkspaceApp();
  Object.assign(workspace.app.workspace, { onLayoutReady: (run: () => void) => run() });
  const setTabStripShown = jest.fn();
  const plugin = { app: workspace.app, registerEvent: jest.fn(), register: jest.fn() };
  trackTabStripShown(
    plugin as unknown as Plugin,
    {
      setTabStripShown,
    } as unknown as AgentSessionManager
  );
  const shown = () => setTabStripShown.mock.calls.at(-1)?.[0];
  return { workspace, shown };
}

describe("trackTabStripShown", () => {
  describe("trackTabStripShown()", () => {
    it("reports the tab strip shown while an Agent Chat leaf is open and the Navigator is closed, and hidden once the Navigator opens or the last Agent Chat leaf closes for https://github.com/Brevilabs/obsidian-copilot-private/issues/849", async () => {
      await setNavigatorAccess("supporter");
      const { workspace, shown } = track();
      expect(shown()).toBe(false);

      workspace.setLeaves({ [CHAT_AGENT_VIEWTYPE]: 1 });
      expect(shown()).toBe(true);

      workspace.setLeaves({ [CHAT_AGENT_VIEWTYPE]: 1, [SESSIONS_SIDEBAR_VIEWTYPE]: 1 });
      expect(shown()).toBe(false);

      workspace.setLeaves({ [CHAT_AGENT_VIEWTYPE]: 2 });
      expect(shown()).toBe(true);

      workspace.setLeaves({});
      expect(shown()).toBe(false);
    });

    it("keeps reporting the tab strip shown beside a Navigator leaf blocked for a user without Navigator access for https://github.com/Brevilabs/obsidian-copilot-private/issues/819", async () => {
      await setNavigatorAccess("free");
      const { workspace, shown } = track();

      workspace.setLeaves({ [CHAT_AGENT_VIEWTYPE]: 1, [SESSIONS_SIDEBAR_VIEWTYPE]: 1 });

      expect(shown()).toBe(true);
    });
  });
});

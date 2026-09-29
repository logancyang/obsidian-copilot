import { createRemoteSessionRuntime } from "@/agentMode/mobile/remoteSessionRuntime";
import {
  FakeVisibility,
  startRemoteRig,
  waitUntil,
  type RemoteRig,
} from "@/agentMode/mobile/remoteTestKit";
import { makeTestSession } from "@/agentMode/session/host/hostTestHarness";
import { setRemoteEventSink, type RemoteEvent } from "@/remote/remoteEvents";
import type { App } from "obsidian";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ agentMode: {} }),
}));
jest.mock("@/plusUtils", () => ({
  ensureMultiAgentEntitlement: jest.fn(async () => true),
  showMultiAgentUpgradePrompt: jest.fn(),
}));

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/613";

async function openRuntime(rig: RemoteRig) {
  const visibility = new FakeVisibility();
  const runtime = createRemoteSessionRuntime({
    app: { workspace: { getActiveFile: () => null } } as unknown as App,
    remote: rig.remote,
    desktop: rig.desktop,
    appVersion: "test-1.0.0",
    visibility,
  });
  await waitUntil(() => runtime.client.getConnection() === "live" && !!runtime.client.getHost());
  return { runtime, visibility };
}

describe("remoteSessionRuntime", () => {
  let rig: RemoteRig;

  beforeEach(async () => {
    rig = await startRemoteRig();
    rig.manager.add(makeTestSession("s1").session);
    rig.manager.add(makeTestSession("s2").session);
  });
  afterEach(async () => {
    await rig.stop();
  });

  describe("createRemoteSessionRuntime()", () => {
    it("shows the last tab of the shared set and tells the desktop it is the tab this phone shows", async () => {
      const { runtime } = await openRuntime(rig);

      expect(runtime.view.getActiveTabId()).toBe("s2");
      await waitUntil(() => rig.host().isSessionFocused("s2"));
      expect(rig.host().isSessionFocused("s1")).toBe(false);
      runtime.dispose();
    });

    it(`reports no focus while the app is in the background and the shown tab again on return (${ISSUE})`, async () => {
      const { runtime, visibility } = await openRuntime(rig);
      await waitUntil(() => rig.host().isSessionFocused("s2"));

      visibility.set(false);
      await waitUntil(() => !rig.host().isSessionFocused("s2"));

      visibility.set(true);
      await waitUntil(() => rig.host().isSessionFocused("s2"));
      runtime.dispose();
    });

    it("leaves the desktop's shown tab and default backend untouched by anything the phone does", async () => {
      const { runtime } = await openRuntime(rig);

      runtime.view.activate({ id: "s1", projectId: "__global__" });
      await waitUntil(() => rig.host().isSessionFocused("s1"));

      expect(rig.manager.calls).toEqual([]);
      runtime.dispose();
    });

    it("drops the draft of a tab the desktop closed", async () => {
      const { runtime } = await openRuntime(rig);
      const closed = runtime.client.getHost()!.tabs.find((tab) => tab.id === "s1")!;
      runtime.drafts.update(closed.chatInputId, (draft) => ({ ...draft, input: "unsent" }));
      expect(runtime.drafts.get(closed.chatInputId)?.input).toBe("unsent");

      rig.manager.remove("s1");
      await waitUntil(() => runtime.client.getHost()!.tabs.every((tab) => tab.id !== "s1"));

      expect(runtime.drafts.get(closed.chatInputId)).toBeUndefined();
      runtime.dispose();
    });

    it(`records one remote_session_opened event no matter how often the link reconnects (${ISSUE})`, async () => {
      const events: RemoteEvent[] = [];
      const restore = setRemoteEventSink((event) => events.push(event));
      const { runtime } = await openRuntime(rig);

      runtime.transport.reconnectNow();
      await waitUntil(() => runtime.client.getConnection() === "live");
      restore();

      expect(events).toEqual([{ name: "remote_session_opened", role: "phone" }]);
      runtime.dispose();
    });

    it("closes the channel and the client on dispose", async () => {
      const { runtime } = await openRuntime(rig);

      runtime.dispose();

      expect(runtime.transport.getLinkState().phase).toBe("closed");
      expect(runtime.client.getConnection()).toBe("offline");
    });
  });
});

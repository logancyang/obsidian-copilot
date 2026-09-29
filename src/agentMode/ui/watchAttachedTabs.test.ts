import { PROTOCOL_VERSION } from "@/agentMode/protocol/frames";
import { SessionClient } from "@/agentMode/protocol/SessionClient";
import { buildTab, FakeTransport } from "@/agentMode/protocol/testBuilders";
import { watchAttachedTabs } from "@/agentMode/ui/watchAttachedTabs";

function liveClient(tabIds: string[]) {
  const transport = new FakeTransport();
  const client = new SessionClient(transport, { app: "1.0.0" });
  transport.setOpen(true);
  transport.deliver({ type: "hello", v: PROTOCOL_VERSION, app: "h", hostId: "h1", ok: true });
  transport.deliver({
    type: "snapshot",
    scope: "host",
    seq: 0,
    state: { tabs: tabIds.map((id) => buildTab({ id })) },
  });
  return { transport, client };
}

const subscribedScopes = (transport: FakeTransport) =>
  transport.sentOfType("subscribe").map((frame) => frame.scope);

describe("watchAttachedTabs", () => {
  describe("watchAttachedTabs()", () => {
    it("subscribes to the session of every tab already attached", () => {
      const { transport, client } = liveClient(["s1", "s2"]);
      watchAttachedTabs(client);
      expect(subscribedScopes(transport)).toEqual(
        expect.arrayContaining(["session:s1", "session:s2"])
      );
    });

    it("subscribes to a tab added later and unsubscribes from a tab removed later", () => {
      const { transport, client } = liveClient(["s1"]);
      watchAttachedTabs(client);

      transport.deliver({
        type: "ops",
        scope: "host",
        from: 1,
        ops: [{ t: "tab.add", index: 1, tab: buildTab({ id: "s2" }) }],
      });
      expect(subscribedScopes(transport)).toContain("session:s2");

      transport.deliver({
        type: "ops",
        scope: "host",
        from: 2,
        ops: [{ t: "tab.remove", id: "s1" }],
      });
      expect(transport.sentOfType("unsubscribe").map((frame) => frame.scope)).toEqual([
        "session:s1",
      ]);
    });

    it("releases every watch when the returned function is called", () => {
      const { transport, client } = liveClient(["s1", "s2"]);
      const stop = watchAttachedTabs(client);

      stop();

      expect(
        transport
          .sentOfType("unsubscribe")
          .map((frame) => frame.scope)
          .sort()
      ).toEqual(["session:s1", "session:s2"]);
    });
  });
});

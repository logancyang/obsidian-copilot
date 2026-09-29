import { logInfo } from "@/logger";
import { setRemoteEventSink, trackRemoteEvent, type RemoteEvent } from "@/remote/remoteEvents";

jest.mock("@/logger", () => ({ logInfo: jest.fn() }));

describe("remoteEvents", () => {
  describe("trackRemoteEvent()", () => {
    it("writes the event name and its enumerated fields to the log by default", () => {
      trackRemoteEvent({ name: "remote_command", command: "send" });
      expect(logInfo).toHaveBeenCalledWith('[remote-event] remote_command {"command":"send"}');
    });

    it("hands the event to a registered sink instead of the log", () => {
      const seen: RemoteEvent[] = [];
      const restore = setRemoteEventSink((event) => seen.push(event));
      jest.mocked(logInfo).mockClear();

      trackRemoteEvent({ name: "remote_session_opened", role: "phone" });

      expect(seen).toEqual([{ name: "remote_session_opened", role: "phone" }]);
      expect(logInfo).not.toHaveBeenCalled();
      restore();
    });

    it("returns to the log sink after the registered sink is removed", () => {
      const restore = setRemoteEventSink(() => {});
      restore();
      trackRemoteEvent({ name: "remote_pair_completed" });
      expect(logInfo).toHaveBeenLastCalledWith("[remote-event] remote_pair_completed {}");
    });

    it("never lets a failing sink break the flow that reported the event", () => {
      const restore = setRemoteEventSink(() => {
        throw new Error("pipeline down");
      });
      expect(() => trackRemoteEvent({ name: "remote_pair_completed" })).not.toThrow();
      restore();
    });
  });
});

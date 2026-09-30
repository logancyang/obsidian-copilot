import {
  describeSdkMessage,
  logSdkInbound,
  logSdkOutbound,
  SDK_FRAME_TAG,
  type SdkFrameSinkLike,
} from "./sdkDebugTap";

const mockLogInfo = jest.fn();
jest.mock("@/logger", () => ({
  logInfo: (...args: unknown[]) => mockLogInfo(...args),
}));

let debugFullFrames = false;
jest.mock("@/settings/model", () => ({
  getSettings: () => ({ agentMode: { debugFullFrames } }),
}));

function fakeSink(): { sink: SdkFrameSinkLike; records: unknown[] } {
  const records: unknown[] = [];
  return {
    records,
    sink: { append: (r) => records.push(r) },
  };
}

beforeEach(() => {
  mockLogInfo.mockClear();
  debugFullFrames = false;
});

describe("sdkDebugTap", () => {
  describe("logSdkOutbound()", () => {
    it("logs one claude-sdk tagged line with the method, session id, and JSON payload", () => {
      const { sink } = fakeSink();

      logSdkOutbound("prompt", { hi: "there" }, "session-1", sink);

      expect(mockLogInfo).toHaveBeenCalledTimes(1);
      const line = mockLogInfo.mock.calls[0][0] as string;
      expect(line).toContain(`[ACP →][${SDK_FRAME_TAG}]`);
      expect(line).toContain("prompt");
      expect(line).toContain("#session-1");
      expect(line).toContain('{"hi":"there"}');
    });

    it("labels a frame sent without a session id as (no-id)", () => {
      const { sink } = fakeSink();

      logSdkOutbound("cancel", {}, null, sink);

      expect(mockLogInfo.mock.calls[0][0]).toContain("(no-id)");
    });

    it("truncates the logged payload past 400 characters", () => {
      const { sink } = fakeSink();

      logSdkOutbound("prompt", { big: "x".repeat(800) }, "s", sink);

      const line = mockLogInfo.mock.calls[0][0] as string;
      expect(line).toContain("…(+");
      expect(line.length).toBeLessThan(800);
    });

    it("still logs a line when the payload cannot be serialized", () => {
      const { sink } = fakeSink();
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;

      expect(() => logSdkOutbound("prompt", cyclic, null, sink)).not.toThrow();
      expect(mockLogInfo).toHaveBeenCalledTimes(1);
    });
  });

  describe("logSdkInbound()", () => {
    it("writes a full notif FrameRecord to the sink when debugFullFrames is on", () => {
      const { sink, records } = fakeSink();
      debugFullFrames = true;

      logSdkInbound("stream_event:content_block_delta", { x: 1 }, "s", sink);

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({
        ts: expect.any(String),
        dir: "←",
        tag: SDK_FRAME_TAG,
        kind: "notif",
        method: "stream_event:content_block_delta",
        id: "s",
        payload: { x: 1 },
      });
    });

    it("writes nothing to the sink when debugFullFrames is off", () => {
      const { sink, records } = fakeSink();

      logSdkInbound("stream_event:content_block_delta", { x: 1 }, "s", sink);

      expect(records).toHaveLength(0);
    });

    it("labels a frame received without a session id as (notif)", () => {
      const { sink } = fakeSink();

      logSdkInbound("acp_notify:plan", {}, null, sink);

      expect(mockLogInfo.mock.calls[0][0]).toContain("(notif)");
    });
  });

  describe("describeSdkMessage()", () => {
    it("annotates a stream_event with its inner event type", () => {
      expect(
        describeSdkMessage({ type: "stream_event", event: { type: "content_block_delta" } })
      ).toBe("stream_event:content_block_delta");
    });

    it("annotates a result with its subtype", () => {
      expect(describeSdkMessage({ type: "result", subtype: "success" })).toBe("result:success");
    });

    it("returns the bare type for assistant and user messages", () => {
      expect(describeSdkMessage({ type: "assistant" })).toBe("assistant");
      expect(describeSdkMessage({ type: "user" })).toBe("user");
    });

    it("returns (unknown) for malformed input", () => {
      expect(describeSdkMessage(null)).toBe("(unknown)");
      expect(describeSdkMessage({})).toBe("(unknown)");
    });
  });
});

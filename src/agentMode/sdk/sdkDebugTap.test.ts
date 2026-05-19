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
  it("always emits a console line with the claude-sdk tag", () => {
    const { sink, records } = fakeSink();
    logSdkOutbound("prompt", { hi: "there" }, "session-1", sink);
    expect(mockLogInfo).toHaveBeenCalledTimes(1);
    const line = mockLogInfo.mock.calls[0][0] as string;
    expect(line).toContain(`[ACP →][${SDK_FRAME_TAG}]`);
    expect(line).toContain("prompt");
    expect(line).toContain("#session-1");
    expect(line).toContain('{"hi":"there"}');
    expect(records).toHaveLength(0);
  });

  it("does not write to disk when debugFullFrames is off", () => {
    const { sink, records } = fakeSink();
    debugFullFrames = false;
    logSdkInbound("stream_event:content_block_delta", { x: 1 }, "s", sink);
    expect(records).toHaveLength(0);
  });

  it("writes a full FrameRecord to disk when debugFullFrames is on", () => {
    const { sink, records } = fakeSink();
    debugFullFrames = true;
    logSdkInbound("stream_event:content_block_delta", { x: 1 }, "s", sink);
    expect(records).toHaveLength(1);
    const rec = records[0] as Record<string, unknown>;
    expect(rec.dir).toBe("←");
    expect(rec.tag).toBe(SDK_FRAME_TAG);
    expect(rec.kind).toBe("notif");
    expect(rec.method).toBe("stream_event:content_block_delta");
    expect(rec.id).toBe("s");
    expect(rec.payload).toEqual({ x: 1 });
    expect(typeof rec.ts).toBe("string");
  });

  it("truncates the console payload past the 400-char limit", () => {
    const { sink } = fakeSink();
    const big = "x".repeat(800);
    logSdkOutbound("prompt", { big }, "s", sink);
    const line = mockLogInfo.mock.calls[0][0] as string;
    expect(line).toContain("…(+");
    expect(line.length).toBeLessThan(800);
  });

  it("survives unserializable payloads on the console path", () => {
    const { sink } = fakeSink();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => logSdkOutbound("prompt", cyclic, null, sink)).not.toThrow();
    expect(mockLogInfo).toHaveBeenCalledTimes(1);
  });

  it("uses (no-id) label when id is omitted on outbound, (notif) on inbound", () => {
    const { sink } = fakeSink();
    logSdkOutbound("cancel", {}, null, sink);
    logSdkInbound("acp_notify:plan", {}, null, sink);
    const lines = mockLogInfo.mock.calls.map((c) => c[0] as string);
    expect(lines[0]).toContain("(no-id)");
    expect(lines[1]).toContain("(notif)");
  });
});

describe("describeSdkMessage", () => {
  it("annotates stream_event with inner event type", () => {
    expect(
      describeSdkMessage({
        type: "stream_event",
        event: { type: "content_block_delta" },
      })
    ).toBe("stream_event:content_block_delta");
  });

  it("annotates result with subtype", () => {
    expect(describeSdkMessage({ type: "result", subtype: "success" })).toBe("result:success");
  });

  it("returns the bare type for assistant/user messages", () => {
    expect(describeSdkMessage({ type: "assistant" })).toBe("assistant");
    expect(describeSdkMessage({ type: "user" })).toBe("user");
  });

  it("returns (unknown) for malformed inputs", () => {
    expect(describeSdkMessage(null)).toBe("(unknown)");
    expect(describeSdkMessage({})).toBe("(unknown)");
  });
});

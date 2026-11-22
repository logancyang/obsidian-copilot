import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { SdkStreamStallGuard } from "./sdkStreamStallGuard";

function streamEvent(innerType: string): SDKMessage {
  return { type: "stream_event", event: { type: innerType } } as unknown as SDKMessage;
}

function resultMessage(): SDKMessage {
  return { type: "result", subtype: "success" } as unknown as SDKMessage;
}

describe("sdkStreamStallGuard", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  describe("SdkStreamStallGuard", () => {
    describe("observe()", () => {
      it("reports a stall once a started message goes quiet for the timeout", () => {
        const onStall = jest.fn();
        const guard = new SdkStreamStallGuard(onStall, 1_000);

        guard.observe(streamEvent("message_start"));
        guard.observe(streamEvent("content_block_delta"));
        jest.advanceTimersByTime(999);
        expect(onStall).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);

        expect(onStall).toHaveBeenCalledTimes(1);
      });

      it("restarts the timeout on every frame while content streams", () => {
        const onStall = jest.fn();
        const guard = new SdkStreamStallGuard(onStall, 1_000);

        guard.observe(streamEvent("content_block_delta"));
        jest.advanceTimersByTime(800);
        guard.observe(streamEvent("content_block_delta"));
        jest.advanceTimersByTime(800);

        expect(onStall).not.toHaveBeenCalled();
      });

      it("does not start the timeout before the first content block event arrives", () => {
        const onStall = jest.fn();
        const guard = new SdkStreamStallGuard(onStall, 1_000);

        guard.observe(streamEvent("message_start"));
        jest.advanceTimersByTime(5_000);

        expect(onStall).not.toHaveBeenCalled();
      });

      it("stays quiet through a long gap after a message completes, such as a running tool", () => {
        const onStall = jest.fn();
        const guard = new SdkStreamStallGuard(onStall, 1_000);

        guard.observe(streamEvent("content_block_delta"));
        guard.observe(streamEvent("message_stop"));
        jest.advanceTimersByTime(5_000);
        guard.observe(resultMessage());
        jest.advanceTimersByTime(5_000);

        expect(onStall).not.toHaveBeenCalled();
      });
    });

    describe("disarm()", () => {
      it("cancels a pending stall, so the next quiet message starts from a fresh guard", () => {
        const onStall = jest.fn();
        const guard = new SdkStreamStallGuard(onStall, 1_000);

        guard.observe(streamEvent("content_block_delta"));
        guard.disarm();
        jest.advanceTimersByTime(5_000);
        guard.observe(streamEvent("message_start"));
        jest.advanceTimersByTime(5_000);

        expect(onStall).not.toHaveBeenCalled();
      });
    });
  });
});

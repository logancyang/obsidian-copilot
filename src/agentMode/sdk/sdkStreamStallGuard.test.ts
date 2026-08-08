import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { guardSdkStreamStall, SDK_STREAM_STALL_MESSAGE } from "./sdkStreamStallGuard";

function streamEvent(innerType: string): SDKMessage {
  return { type: "stream_event", event: { type: innerType } } as unknown as SDKMessage;
}

function resultMessage(): SDKMessage {
  return { type: "result", subtype: "success" } as unknown as SDKMessage;
}

async function collect(stream: AsyncIterable<SDKMessage>): Promise<string[]> {
  const seen: string[] = [];
  for await (const m of stream) {
    seen.push(
      m.type === "stream_event" ? `stream:${(m as { event: { type: string } }).event.type}` : m.type
    );
  }
  return seen;
}

/** A source whose messages and completion are driven by the test. */
function controllableSource() {
  const queue: SDKMessage[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  const wakeUp = (): void => {
    const w = wake;
    wake = null;
    w?.();
  };
  return {
    push: (m: SDKMessage): void => {
      queue.push(m);
      wakeUp();
    },
    finish: (): void => {
      done = true;
      wakeUp();
    },
    iterable: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (queue.length) yield queue.shift() as SDKMessage;
          if (done) return;
          await new Promise<void>((r) => {
            wake = r;
          });
        }
      },
    } as AsyncIterable<SDKMessage>,
  };
}

describe("guardSdkStreamStall", () => {
  it("yields every message unchanged and never trips on a clean stream", async () => {
    async function* source(): AsyncGenerator<SDKMessage> {
      yield streamEvent("message_start");
      yield streamEvent("content_block_delta");
      yield streamEvent("message_stop");
      yield resultMessage();
    }
    const abortController = new AbortController();
    const onStall = jest.fn();

    const seen = await collect(guardSdkStreamStall(source(), { abortController, onStall }));

    expect(seen).toEqual([
      "stream:message_start",
      "stream:content_block_delta",
      "stream:message_stop",
      "result",
    ]);
    expect(onStall).not.toHaveBeenCalled();
    expect(abortController.signal.aborted).toBe(false);
  });

  it("aborts and throws the stall error when a message stalls mid-stream", async () => {
    const abortController = new AbortController();
    const onStall = jest.fn();
    // Emits two mid-message chunks (arming the watchdog) then hangs until the
    // guard aborts — a half-open response with no terminal `result`.
    async function* source(): AsyncGenerator<SDKMessage> {
      yield streamEvent("message_start");
      yield streamEvent("content_block_delta");
      await new Promise<void>((resolve) => {
        abortController.signal.addEventListener("abort", () => resolve(), { once: true });
      });
    }

    jest.useFakeTimers();
    try {
      const run = collect(
        guardSdkStreamStall(source(), { abortController, timeoutMs: 1_000, onStall })
      );
      const assertion = expect(run).rejects.toThrow(SDK_STREAM_STALL_MESSAGE);
      await jest.advanceTimersByTimeAsync(1_500);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
    expect(onStall).toHaveBeenCalledWith(1_000);
    expect(abortController.signal.aborted).toBe(true);
  });

  it("does not start timing until the first content event arrives", async () => {
    const abortController = new AbortController();
    const onStall = jest.fn();
    const src = controllableSource();

    jest.useFakeTimers();
    try {
      const run = collect(
        guardSdkStreamStall(src.iterable, { abortController, timeoutMs: 1_000, onStall })
      );

      src.push(streamEvent("message_start"));
      await jest.advanceTimersByTimeAsync(5_000);
      expect(onStall).not.toHaveBeenCalled();
      expect(abortController.signal.aborted).toBe(false);

      src.push(streamEvent("content_block_delta"));
      await jest.advanceTimersByTimeAsync(0);
      src.push(streamEvent("message_stop"));
      src.push(resultMessage());
      src.finish();
      await expect(run).resolves.toEqual([
        "stream:message_start",
        "stream:content_block_delta",
        "stream:message_stop",
        "result",
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not trip during a long quiet gap between messages", async () => {
    const abortController = new AbortController();
    const onStall = jest.fn();
    const src = controllableSource();

    jest.useFakeTimers();
    try {
      const run = collect(
        guardSdkStreamStall(src.iterable, { abortController, timeoutMs: 1_000, onStall })
      );

      // Stream a complete message, then go quiet *between* messages.
      src.push(streamEvent("message_start"));
      src.push(streamEvent("content_block_delta"));
      src.push(streamEvent("message_stop"));
      await jest.advanceTimersByTimeAsync(0);

      // A gap far longer than the window must not trip the guard here.
      await jest.advanceTimersByTimeAsync(5_000);
      expect(onStall).not.toHaveBeenCalled();
      expect(abortController.signal.aborted).toBe(false);

      // The stream resumes and ends normally.
      src.push(resultMessage());
      src.finish();
      await expect(run).resolves.toEqual([
        "stream:message_start",
        "stream:content_block_delta",
        "stream:message_stop",
        "result",
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("re-throws a real source error unchanged instead of a stall", async () => {
    const abortController = new AbortController();
    const onStall = jest.fn();
    async function* source(): AsyncGenerator<SDKMessage> {
      yield streamEvent("message_start");
      throw new Error("network down");
    }

    await expect(
      collect(guardSdkStreamStall(source(), { abortController, onStall }))
    ).rejects.toThrow("network down");
    expect(onStall).not.toHaveBeenCalled();
    expect(abortController.signal.aborted).toBe(false);
  });
});

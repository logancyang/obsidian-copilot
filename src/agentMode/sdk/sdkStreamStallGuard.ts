/**
 * Mid-stream stall guard — **Claude Agent SDK only.**
 *
 * Why it exists: the driver loop in `ClaudeSdkBackendProcess.prompt()` advances
 * only when the `query()` async-iterator yields. If a streaming response goes
 * half-open mid-message (so no terminal `result` ever arrives), `for await`
 * would park forever and wedge the turn in a permanent "running" state.
 * `guardSdkStreamStall` wraps the stream and, *while an assistant message is
 * actively streaming*, aborts the query when no chunk arrives within
 * `timeoutMs` — turning a silent hang into a surfaced error the session can
 * recover from.
 *
 * Streamed tokens arrive sub-second once content starts, so a multi-second
 * mid-message gap means the stream died. The timer is armed only after the
 * first content block event and until `message_stop`; first-token latency and
 * gaps *between* messages (tool execution, permission waits) are never timed.
 */
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export const SDK_STREAM_STALL_TIMEOUT_MS = 60_000;

export const SDK_STREAM_STALL_MESSAGE =
  `Claude stopped responding — the response stream stalled mid-reply (no output for ` +
  `${SDK_STREAM_STALL_TIMEOUT_MS / 1000}s) and the turn was ended. Send your message again to continue.`;

export interface SdkStreamStallGuardOptions {
  /** Aborted on stall so the SDK stops and cleans up the in-flight request. */
  abortController: AbortController;
  /** Override the default idle window (mainly for tests). */
  timeoutMs?: number;
  /** Invoked once when a stall is detected, before the abort (for logging). */
  onStall?: (timeoutMs: number) => void;
}

function streamEventType(msg: SDKMessage): string | null {
  if (msg.type !== "stream_event") return null;
  const evType = (msg as { event?: { type?: unknown } }).event?.type;
  return typeof evType === "string" ? evType : null;
}

function isContentStreamEvent(evType: string | null): boolean {
  return (
    evType === "content_block_start" ||
    evType === "content_block_delta" ||
    evType === "content_block_stop"
  );
}

/**
 * Yields every message from `source` unchanged. If the stream stalls mid-
 * message, aborts `abortController` and — once the underlying iterator unwinds
 * — throws `Error(SDK_STREAM_STALL_MESSAGE)`. Real transport errors propagate
 * as-is.
 */
export async function* guardSdkStreamStall(
  source: AsyncIterable<SDKMessage>,
  { abortController, timeoutMs = SDK_STREAM_STALL_TIMEOUT_MS, onStall }: SdkStreamStallGuardOptions
): AsyncGenerator<SDKMessage> {
  let stalled = false;
  let contentStarted = false;
  let timer: number | undefined;
  const disarm = (): void => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  };
  try {
    for await (const msg of source) {
      disarm();
      const evType = streamEventType(msg);
      if (isContentStreamEvent(evType)) contentStarted = true;
      if (evType === "message_stop") contentStarted = false;
      if (contentStarted && evType !== "message_stop") {
        timer = window.setTimeout(() => {
          stalled = true;
          onStall?.(timeoutMs);
          abortController.abort();
        }, timeoutMs);
      }
      yield msg;
    }
  } catch (e) {
    // The abort surfaces as an iterator throw; suppress it so the stall error
    // below wins. Anything else is a real transport error — re-throw it.
    if (!stalled) throw e;
  } finally {
    disarm();
  }
  if (stalled) throw new Error(SDK_STREAM_STALL_MESSAGE);
}

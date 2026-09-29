import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export const SDK_STREAM_STALL_TIMEOUT_MS = 60_000;

export const SDK_STREAM_STALL_MESSAGE =
  `Claude stopped responding — the response stream stalled mid-reply (no output for ` +
  `${SDK_STREAM_STALL_TIMEOUT_MS / 1000}s) and the turn was ended. Send your message again to continue.`;

export interface SdkStreamStallGuardOptions {
  abortController: AbortController;
  timeoutMs?: number;
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
    if (!stalled) throw e;
  } finally {
    disarm();
  }
  if (stalled) throw new Error(SDK_STREAM_STALL_MESSAGE);
}

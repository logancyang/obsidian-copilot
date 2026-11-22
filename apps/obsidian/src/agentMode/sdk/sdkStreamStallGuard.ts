import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export const SDK_STREAM_STALL_TIMEOUT_MS = 60_000;

export const SDK_STREAM_STALL_MESSAGE =
  `Claude stopped responding — the response stream stalled mid-reply (no output for ` +
  `${SDK_STREAM_STALL_TIMEOUT_MS / 1000}s) and the turn was ended. Send your message again to continue.`;

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

export class SdkStreamStallGuard {
  private timer: number | undefined;
  private contentStarted = false;

  constructor(
    private readonly onStall: () => void,
    private readonly timeoutMs = SDK_STREAM_STALL_TIMEOUT_MS
  ) {}

  observe(msg: SDKMessage): void {
    this.clearTimer();
    const evType = streamEventType(msg);
    if (isContentStreamEvent(evType)) this.contentStarted = true;
    if (evType === "message_stop") this.contentStarted = false;
    if (!this.contentStarted) return;
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      this.contentStarted = false;
      this.onStall();
    }, this.timeoutMs);
  }

  disarm(): void {
    this.clearTimer();
    this.contentStarted = false;
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    window.clearTimeout(this.timer);
    this.timer = undefined;
  }
}

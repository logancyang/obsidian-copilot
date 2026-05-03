/**
 * Debug tap for the Claude Agent SDK adapter. Each call logs one frame to the
 * console (truncated) and, when `agentMode.debugFullFrames` is on, appends
 * the full payload to the shared `acp-frames.ndjson` sink. Frames carry
 * `tag: "claude-sdk"` to distinguish from ACP frames in the same log.
 * @see ../acp/debugTap.ts for the JSON-RPC stream variant.
 */
import { logInfo } from "@/logger";
import { getSettings } from "@/settings/model";
import { formatPayload } from "@/agentMode/acp/debugTap";
import { frameSink, type FrameRecord } from "@/agentMode/acp/frameSink";

export const SDK_FRAME_TAG = "claude-sdk";

export type SdkFrameKind = FrameRecord["kind"];
export type SdkFrameDir = "→" | "←";

export interface SdkFrameSinkLike {
  append(record: FrameRecord): void;
}

export interface LogSdkFrameArgs {
  dir: SdkFrameDir;
  method: string;
  /** SDK session id, request id, or any correlator. Null/undefined for un-keyed frames. */
  id?: string | null;
  payload?: unknown;
  /** Defaults to "request" for outbound, "notif" for inbound. */
  kind?: SdkFrameKind;
}

/**
 * Internal entry point. Exposed for tests; production callers should use
 * the convenience wrappers below.
 */
export function logSdkFrame(args: LogSdkFrameArgs, sink: SdkFrameSinkLike = frameSink): void {
  const id = args.id ?? null;
  const idLabel = id !== null ? `#${id}` : args.kind === "notif" ? "(notif)" : "(no-id)";
  logInfo(
    `[ACP ${args.dir}][${SDK_FRAME_TAG}] ${args.method}  ${idLabel}  ${formatPayload(args.payload)}`
  );

  if (!getSettings().agentMode?.debugFullFrames) return;
  sink.append({
    ts: new Date().toISOString(),
    dir: args.dir,
    tag: SDK_FRAME_TAG,
    kind: args.kind ?? (args.dir === "→" ? "request" : "notif"),
    method: args.method,
    id,
    payload: args.payload,
  });
}

/** Outbound RPC or control call (we → SDK). */
export function logSdkOutbound(
  method: string,
  payload: unknown,
  id?: string | null,
  sink?: SdkFrameSinkLike
): void {
  logSdkFrame({ dir: "→", method, id, payload, kind: "request" }, sink);
}

/** Outbound RPC result (we → caller / response we are about to return). */
export function logSdkOutboundResult(
  method: string,
  payload: unknown,
  id?: string | null,
  sink?: SdkFrameSinkLike
): void {
  logSdkFrame({ dir: "→", method, id, payload, kind: "result" }, sink);
}

/** Inbound SDK message or translated ACP notification (SDK → us). */
export function logSdkInbound(
  method: string,
  payload: unknown,
  id?: string | null,
  sink?: SdkFrameSinkLike
): void {
  logSdkFrame({ dir: "←", method, id, payload, kind: "notif" }, sink);
}

/** Inbound or outbound error frame. */
export function logSdkError(
  dir: SdkFrameDir,
  method: string,
  payload: unknown,
  id?: string | null,
  sink?: SdkFrameSinkLike
): void {
  logSdkFrame({ dir, method, id, payload, kind: "error" }, sink);
}

/**
 * Synthesize a stable "method" label for an SDK message so the trace reads
 * similarly to ACP JSON-RPC method names. `stream_event` carries the inner
 * event type to make the high-frequency stream readable.
 */
export function describeSdkMessage(msg: unknown): string {
  const m = msg as { type?: unknown; event?: { type?: unknown }; subtype?: unknown };
  if (!m || typeof m.type !== "string") return "(unknown)";
  if (m.type === "stream_event") {
    const ev = m.event && typeof m.event === "object" ? m.event : null;
    const evType = ev && typeof ev.type === "string" ? ev.type : "?";
    return `stream_event:${evType}`;
  }
  if (m.type === "result" && typeof m.subtype === "string") {
    return `result:${m.subtype}`;
  }
  return m.type;
}

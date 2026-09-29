import { logInfo } from "@/logger";
import { getSettings } from "@/settings/model";
import { formatPayload, frameSink, type FrameRecord } from "@/agentMode/session/debugSink";

export const SDK_FRAME_TAG = "claude-sdk";

export type SdkFrameKind = FrameRecord["kind"];
export type SdkFrameDir = "→" | "←";

export interface SdkFrameSinkLike {
  append(record: FrameRecord): void;
}

export interface LogSdkFrameArgs {
  dir: SdkFrameDir;
  method: string;
  id?: string | null;
  payload?: unknown;
  kind?: SdkFrameKind;
}

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

export function logSdkOutbound(
  method: string,
  payload: unknown,
  id?: string | null,
  sink?: SdkFrameSinkLike
): void {
  logSdkFrame({ dir: "→", method, id, payload, kind: "request" }, sink);
}

export function logSdkOutboundResult(
  method: string,
  payload: unknown,
  id?: string | null,
  sink?: SdkFrameSinkLike
): void {
  logSdkFrame({ dir: "→", method, id, payload, kind: "result" }, sink);
}

export function logSdkInbound(
  method: string,
  payload: unknown,
  id?: string | null,
  sink?: SdkFrameSinkLike
): void {
  logSdkFrame({ dir: "←", method, id, payload, kind: "notif" }, sink);
}

export function logSdkError(
  dir: SdkFrameDir,
  method: string,
  payload: unknown,
  id?: string | null,
  sink?: SdkFrameSinkLike
): void {
  logSdkFrame({ dir, method, id, payload, kind: "error" }, sink);
}

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

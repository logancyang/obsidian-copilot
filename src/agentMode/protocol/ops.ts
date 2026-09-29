import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import type { AgentMessagePart, SessionId, StopReason } from "@/agentMode/session/types";
import type {
  BackendSummary,
  HostFlags,
  MessageOf,
  SessionState,
  TabPatch,
  TabSummary,
  WireMessageContext,
} from "@/agentMode/protocol/state";

export type TranscriptOp<C> =
  | { t: "msg.add"; message: MessageOf<C> }
  | { t: "msg.turnComplete"; id: string; stopReason: StopReason; durationMs: number; atMs: number }
  | { t: "msg.extendDuration"; id: string; durationMs: number }
  | { t: "msg.setFanout"; id: string; turn: FanoutTurn }
  | { t: "msg.appendText"; id: string; text: string; atMs: number }
  | { t: "msg.appendThought"; id: string; text: string; atMs: number }
  | { t: "msg.upsertPart"; id: string; part: AgentMessagePart; atMs: number }
  | { t: "msg.markError"; id: string; errorText: string; durationMs?: number; atMs: number }
  | { t: "transcript.set"; messages: readonly MessageOf<C>[] };

export type SliceKey = "backendState" | "pending" | "plan" | "todos" | "usage" | "planUsage";

export type SliceOp = {
  [K in SliceKey]: { t: "slice"; key: K; value: SessionState[K] };
}[SliceKey];

export type SessionOp = TranscriptOp<WireMessageContext> | SliceOp;

export type HostOp =
  | { t: "tab.add"; index: number; tab: TabSummary }
  | { t: "tab.remove"; id: SessionId }
  | { t: "tab.patch"; id: SessionId; patch: TabPatch }
  | { t: "backend.set"; index: number; backend: BackendSummary }
  | { t: "host.patch"; patch: Partial<HostFlags> };

export type ScopeOp = HostOp | SessionOp;

export const STREAMING_OP_TYPES: ReadonlySet<string> = new Set([
  "msg.appendText",
  "msg.appendThought",
  "msg.upsertPart",
  "msg.setFanout",
  "msg.extendDuration",
]);

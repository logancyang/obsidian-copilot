import { logInfo } from "@/logger";

// Each field is a name from a fixed set (a pairing outcome, a role, a protocol command name), so an
// event carries no message text, note path or session id.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
export type PairFailureReason =
  | "invalid-link"
  | "wrong-vault"
  | "unreachable"
  | "expired-or-used"
  | "protocol";

export type RemoteEvent =
  | { name: "remote_pair_completed" }
  | { name: "remote_pair_failed"; reason: PairFailureReason }
  | { name: "remote_session_opened"; role: "phone" | "desktop" }
  | { name: "remote_command"; command: string };

export type RemoteEventSink = (event: RemoteEvent) => void;

// The repository has no client-side event pipeline: the only analytics today are the server's own
// license-check events, whose properties the server allowlists. Until a pipeline exists the default
// sink writes the event to the log, and a pipeline replaces it with setRemoteEventSink.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
const logSink: RemoteEventSink = (event) => {
  const { name, ...properties } = event;
  logInfo(`[remote-event] ${name} ${JSON.stringify(properties)}`);
};

let sink: RemoteEventSink = logSink;

export function setRemoteEventSink(next: RemoteEventSink): () => void {
  sink = next;
  return () => {
    if (sink === next) sink = logSink;
  };
}

export function trackRemoteEvent(event: RemoteEvent): void {
  try {
    sink(event);
  } catch {}
}

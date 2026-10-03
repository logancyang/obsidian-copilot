import type { AnyMessage, SessionNotification, Stream } from "@agentclientprotocol/sdk";
import { logWarn } from "@/logger";

const SESSION_UPDATE_METHOD = "session/update";

export function deliverSessionUpdatesInWireOrder(
  stream: Stream,
  deliver: (notification: SessionNotification) => void
): Stream {
  // The SDK settles a response before dispatching notifications read ahead of it, so session/load
  // resolved before its replay landed; route updates here, where wire order still holds.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/602
  const readable = stream.readable.pipeThrough(
    new TransformStream<AnyMessage, AnyMessage>({
      transform(message, controller) {
        if (!("method" in message) || message.method !== SESSION_UPDATE_METHOD) {
          controller.enqueue(message);
        } else if (isRoutableSessionUpdate(message.params)) {
          deliver(message.params);
        } else {
          logWarn(`[AgentMode] dropping malformed ${SESSION_UPDATE_METHOD}`, message.params);
        }
      },
    })
  );
  return { readable, writable: stream.writable };
}

// These updates bypass the SDK's schema parse; routing reads only these fields, and the translator tolerates the rest.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/602
function isRoutableSessionUpdate(params: unknown): params is SessionNotification {
  if (!isObject(params) || typeof params.sessionId !== "string") return false;
  return isObject(params.update) && typeof params.update.sessionUpdate === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

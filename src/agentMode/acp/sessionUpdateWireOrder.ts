import type { AnyMessage, SessionNotification, Stream } from "@agentclientprotocol/sdk";

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
        if ("method" in message && message.method === SESSION_UPDATE_METHOD) {
          deliver(message.params as SessionNotification);
        } else {
          controller.enqueue(message);
        }
      },
    })
  );
  return { readable, writable: stream.writable };
}

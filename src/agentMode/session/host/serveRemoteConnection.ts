import type { CommandName } from "@/agentMode/protocol/commands";
import { parseClientFrame } from "@/agentMode/protocol/frameCodec";
import type { ServerFrame } from "@/agentMode/protocol/frames";
import type { HostConnection } from "@/agentMode/session/host/SessionHost";
import { logWarn } from "@/logger";

export interface PhoneConnection {
  send(text: string): void;
  onMessage(handler: (text: string) => void): () => void;
  onClose(handler: (event: { code: number }) => void): () => void;
  close(code?: number): void;
}

export interface ServeRemoteConnectionOptions {
  onSessionStart?: () => void;
  onCommand?: (name: CommandName) => void;
}

// The name comes off the wire and reaches an event sink, so an over-long one is not reported.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
const MAX_COMMAND_NAME_CHARS = 40;

const CLOSE_GOING_AWAY = 1001;
const CLOSE_UNSUPPORTED_DATA = 1003;
const CLOSE_MESSAGE_TOO_BIG = 1009;

// A snapshot of one very long session is the largest frame the host sends. Beyond this the frame
// is refused and the connection closed rather than buffered for a peer that may not drain it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
export const MAX_OUTBOUND_FRAME_CHARS = 32 * 1024 * 1024;

// Moves text frames between an authenticated phone connection and `SessionHost.connect` and adds
// no protocol logic. Returns a function that detaches the phone from the host.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
export function serveRemoteConnection(
  host: { connect(send: (frame: ServerFrame) => void, onClose?: () => void): HostConnection },
  connection: PhoneConnection,
  options: ServeRemoteConnectionOptions = {}
): () => void {
  let detached = false;
  let started = false;
  const hostConnection = host.connect(
    (frame) => {
      if (detached) return;
      const text = JSON.stringify(frame);
      if (text.length > MAX_OUTBOUND_FRAME_CHARS) {
        logWarn("Remote frame too large to send; closing the connection");
        connection.close(CLOSE_MESSAGE_TOO_BIG);
        return;
      }
      connection.send(text);
    },
    () => connection.close(CLOSE_GOING_AWAY)
  );

  const stopMessages = connection.onMessage((text) => {
    if (detached) return;
    const frame = parseClientFrame(text);
    if (!frame) {
      connection.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }
    if (frame.type === "hello" && !started) {
      started = true;
      options.onSessionStart?.();
    }
    if (frame.type === "command" && frame.command.name.length <= MAX_COMMAND_NAME_CHARS) {
      options.onCommand?.(frame.command.name);
    }
    hostConnection.receive(frame);
  });

  let stopClose: () => void = () => {};
  const detach = (): void => {
    if (detached) return;
    detached = true;
    stopMessages();
    stopClose();
    hostConnection.close();
  };
  stopClose = connection.onClose(detach);
  return detach;
}

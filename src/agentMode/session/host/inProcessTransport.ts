import type { ClientFrame, ServerFrame } from "@/agentMode/protocol/frames";
import type { ClientTransport } from "@/agentMode/protocol/transport";
import type { HostConnection, SessionHost } from "@/agentMode/session/host/SessionHost";

export interface InProcessTransportOptions {
  serialize: boolean;
}

export function createInProcessTransport(
  host: Pick<SessionHost, "connect">,
  options: InProcessTransportOptions
): ClientTransport {
  const frameListeners = new Set<(frame: ServerFrame) => void>();
  const openListeners = new Set<(open: boolean) => void>();
  let connection: HostConnection | null = null;
  let isOpen = false;
  let closed = false;

  const carry = <F extends ClientFrame | ServerFrame>(frame: F): F =>
    options.serialize ? (JSON.parse(JSON.stringify(frame)) as F) : frame;

  const setOpen = (open: boolean): void => {
    isOpen = open;
    for (const listener of [...openListeners]) listener(open);
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    connection?.close();
    connection = null;
    if (isOpen) setOpen(false);
  };

  const hostConnection = (): HostConnection => {
    connection ??= host.connect((frame) => {
      const delivered = carry(frame);
      queueMicrotask(() => {
        if (closed) return;
        for (const listener of [...frameListeners]) listener(delivered);
      });
    }, close);
    return connection;
  };

  return {
    send(frame) {
      if (closed || !isOpen) return;
      const delivered = carry(frame);
      queueMicrotask(() => {
        if (!closed) hostConnection().receive(delivered);
      });
    },
    onFrame(cb) {
      frameListeners.add(cb);
      return () => {
        frameListeners.delete(cb);
      };
    },
    onOpenChange(cb) {
      openListeners.add(cb);
      queueMicrotask(() => {
        if (!closed && !isOpen) setOpen(true);
      });
      return () => {
        openListeners.delete(cb);
      };
    },
    close,
  };
}

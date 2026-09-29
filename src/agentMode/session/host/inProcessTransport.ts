import type { ClientFrame, ServerFrame } from "@/agentMode/protocol/frames";
import type { ClientTransport } from "@/agentMode/protocol/transport";
import type { HostConnection, SessionHost } from "@/agentMode/session/host/SessionHost";

export interface InProcessTransportOptions {
  serialize: boolean;
}

export interface InProcessTransport extends ClientTransport {
  disconnect(): void;
  reconnect(): void;
  dropNextFrame(): void;
}

export function createInProcessTransport(
  host: Pick<SessionHost, "connect">,
  options: InProcessTransportOptions
): InProcessTransport {
  const frameListeners = new Set<(frame: ServerFrame) => void>();
  const openListeners = new Set<(open: boolean) => void>();
  let connection: HostConnection | null = null;
  let generation = 0;
  let isOpen = false;
  let closed = false;
  let framesToDrop = 0;

  const carry = <F extends ClientFrame | ServerFrame>(frame: F): F =>
    options.serialize ? (JSON.parse(JSON.stringify(frame)) as F) : frame;

  const setOpen = (open: boolean): void => {
    isOpen = open;
    for (const listener of [...openListeners]) listener(open);
  };

  const hostConnection = (): HostConnection => {
    const owner = generation;
    connection ??= host.connect((frame) => {
      if (owner !== generation) return;
      if (framesToDrop > 0) {
        framesToDrop -= 1;
        return;
      }
      const delivered = carry(frame);
      queueMicrotask(() => {
        if (closed || owner !== generation) return;
        for (const listener of [...frameListeners]) listener(delivered);
      });
    });
    return connection;
  };

  return {
    send(frame) {
      if (closed || !isOpen) return;
      const owner = generation;
      const delivered = carry(frame);
      queueMicrotask(() => {
        if (!closed && owner === generation) hostConnection().receive(delivered);
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
        if (!closed && !isOpen && generation === 0) setOpen(true);
      });
      return () => {
        openListeners.delete(cb);
      };
    },
    close() {
      if (closed) return;
      closed = true;
      connection?.close();
      connection = null;
      if (isOpen) setOpen(false);
    },
    disconnect() {
      if (closed || !isOpen) return;
      generation += 1;
      connection?.close();
      connection = null;
      setOpen(false);
    },
    reconnect() {
      if (closed || isOpen) return;
      setOpen(true);
    },
    dropNextFrame() {
      framesToDrop += 1;
    },
  };
}

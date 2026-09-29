import {
  type ChannelClientFrame,
  type ChannelServerFrame,
  type DenyReason,
  parseServerFrame,
  type RemoteChannel,
} from "@/remote/wire";

export interface SocketEvent {
  data?: unknown;
  code?: number;
}

export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: SocketEvent) => void): void;
}

export const SOCKET_OPEN = 1;

export interface OpenChannelOptions {
  createSocket?: (url: string) => SocketLike;
  connectTimeoutMs?: number;
  replyTimeoutMs?: number;
}

export type HandshakeReply = Extract<ChannelServerFrame, { type: "paired" | "authed" }>;

export type OpenChannelResult =
  | { ok: true; reply: HandshakeReply; channel: RemoteChannel }
  | { ok: false; reason: "unreachable" | "timeout" | "protocol" }
  | { ok: false; reason: "denied"; denyReason: DenyReason };

export const DEFAULT_CONNECT_TIMEOUT_MS = 8000;
export const DEFAULT_REPLY_TIMEOUT_MS = 8000;

// Obsidian iOS leaves a socket to an unreachable Tailscale address in CONNECTING for over 12 s
// instead of failing, so the caller needs its own deadline.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/610
function defaultCreateSocket(url: string): SocketLike {
  return new WebSocket(url);
}

function toChannel(socket: SocketLike): {
  channel: RemoteChannel;
  deliver: (text: string) => void;
  notifyClosed: (code: number) => void;
} {
  const messageHandlers = new Set<(text: string) => void>();
  const closeHandlers = new Set<(event: { code: number }) => void>();
  const backlog: string[] = [];
  let closedWith: number | null = null;

  const channel: RemoteChannel = {
    send(text) {
      if (socket.readyState === SOCKET_OPEN) socket.send(text);
    },
    onMessage(handler) {
      messageHandlers.add(handler);
      for (const text of backlog.splice(0)) handler(text);
      return () => messageHandlers.delete(handler);
    },
    onClose(handler) {
      if (closedWith !== null) {
        handler({ code: closedWith });
        return () => {};
      }
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    close(code) {
      socket.close(code);
    },
  };

  return {
    channel,
    deliver(text) {
      if (messageHandlers.size === 0) {
        backlog.push(text);
        return;
      }
      for (const handler of [...messageHandlers]) handler(text);
    },
    notifyClosed(code) {
      closedWith = code;
      for (const handler of [...closeHandlers]) handler({ code });
      closeHandlers.clear();
    },
  };
}

export function openChannel(
  url: string,
  firstFrame: ChannelClientFrame,
  options: OpenChannelOptions = {}
): Promise<OpenChannelResult> {
  const {
    createSocket = defaultCreateSocket,
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    replyTimeoutMs = DEFAULT_REPLY_TIMEOUT_MS,
  } = options;

  return new Promise((resolve) => {
    let settled = false;
    let timer: number | undefined;
    let socket: SocketLike;
    try {
      socket = createSocket(url);
    } catch {
      resolve({ ok: false, reason: "unreachable" });
      return;
    }
    const plumbing = toChannel(socket);
    const expectedReply = firstFrame.type === "pair" ? "paired" : "authed";

    const finish = (result: OpenChannelResult): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (!result.ok) {
        try {
          socket.close();
        } catch {}
      }
      resolve(result);
    };

    timer = window.setTimeout(() => finish({ ok: false, reason: "timeout" }), connectTimeoutMs);

    socket.addEventListener("open", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => finish({ ok: false, reason: "timeout" }), replyTimeoutMs);
      socket.send(JSON.stringify(firstFrame));
    });
    socket.addEventListener("error", () => finish({ ok: false, reason: "unreachable" }));
    socket.addEventListener("close", (event) => {
      finish({ ok: false, reason: "unreachable" });
      plumbing.notifyClosed(event.code ?? 1006);
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      if (settled) {
        plumbing.deliver(event.data);
        return;
      }
      const reply = parseServerFrame(event.data);
      if (reply?.type === "denied") {
        finish({ ok: false, reason: "denied", denyReason: reply.reason });
      } else if (reply?.type === expectedReply) {
        finish({ ok: true, reply, channel: plumbing.channel });
      } else {
        finish({ ok: false, reason: "protocol" });
      }
    });
  });
}

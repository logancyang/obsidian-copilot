import type { ChatFeed, ClientFrame, HostFeed, HostFrame } from "@copilot/protocol/frames";
import type { HostState } from "@copilot/protocol/host";
import {
  applySessionOp,
  applySliceOp,
  type LiveChatId,
  type SessionState,
} from "@copilot/protocol/session";

interface Feed<S> {
  watchers: number;
  replica: { state: S; seq: number; awaitingSnapshot: boolean } | null;
}

type FeedFrame<S, O> =
  | { type: "snapshot"; seq: number; state: S }
  | { type: "ops"; from: number; ops: readonly O[] };

export class SessionClient {
  private readonly chats = new Map<LiveChatId, Feed<SessionState>>();
  private readonly host: Feed<HostState> = { watchers: 0, replica: null };
  private readonly listeners = new Set<() => void>();

  constructor(private readonly send: (frame: ClientFrame) => void) {}

  receive(frame: HostFrame): void {
    if (frame.feed === "host") {
      this.receiveFeed(this.host, { feed: "host" }, frame, applySliceOp);
      return;
    }
    const chat = this.chats.get(frame.liveChatId);
    if (!chat) return;
    this.receiveFeed(chat, { feed: "chat", liveChatId: frame.liveChatId }, frame, applySessionOp);
  }

  watch(liveChatId: LiveChatId): () => void {
    let chat = this.chats.get(liveChatId);
    if (!chat) {
      chat = { watchers: 0, replica: null };
      this.chats.set(liveChatId, chat);
    }
    return this.watchFeed(chat, { feed: "chat", liveChatId }, () => this.chats.delete(liveChatId));
  }

  watchHost(): () => void {
    return this.watchFeed(this.host, { feed: "host" }, () => {});
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(liveChatId: LiveChatId): SessionState | null {
    return this.chats.get(liveChatId)?.replica?.state ?? null;
  }

  getHostState(): HostState | null {
    return this.host.replica?.state ?? null;
  }

  private watchFeed<S>(feed: Feed<S>, target: ChatFeed | HostFeed, forget: () => void): () => void {
    feed.watchers += 1;
    if (feed.watchers === 1) this.send({ type: "subscribe", ...target });
    return () => {
      feed.watchers -= 1;
      if (feed.watchers > 0) return;
      feed.replica = null;
      forget();
      this.send({ type: "unsubscribe", ...target });
    };
  }

  private receiveFeed<S, O>(
    feed: Feed<S>,
    target: ChatFeed | HostFeed,
    frame: FeedFrame<S, O>,
    apply: (state: S, op: O) => S
  ): void {
    if (feed.watchers === 0) return;
    if (frame.type === "snapshot") {
      feed.replica = { state: frame.state, seq: frame.seq, awaitingSnapshot: false };
      this.notify();
      return;
    }
    const replica = feed.replica;
    if (!replica || replica.awaitingSnapshot) return;
    if (frame.from !== replica.seq + 1) {
      replica.awaitingSnapshot = true;
      this.send({ type: "subscribe", ...target });
      return;
    }
    replica.state = frame.ops.reduce(apply, replica.state);
    replica.seq += frame.ops.length;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

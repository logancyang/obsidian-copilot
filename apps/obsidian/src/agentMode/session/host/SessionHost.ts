import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { ClientFrame, HostFrame } from "@copilot/protocol/frames";
import type { HostOp, HostState } from "@copilot/protocol/host";
import type { PickerCatalog } from "@copilot/protocol/pickerCatalog";
import {
  applySessionOp,
  applySliceOp,
  EMPTY_SESSION_STATE,
  type LiveChatId,
  type SessionOp,
  type SessionState,
} from "@copilot/protocol/session";

export type HostChat = Pick<AgentSession, "subscribe" | "getSessionUsage" | "getPlanUsage">;

export interface HostChats {
  getSession(id: string): HostChat | null;
}

export interface HostSliceSource<T> {
  read(): T;
  subscribe(onChange: () => void): () => void;
}

type Connection = (frame: HostFrame) => void;

interface Feed<S> {
  state: S;
  seq: number;
  subscribers: Set<Connection>;
  stopListening: () => void;
}

interface LiveChat extends Feed<SessionState> {
  chat: HostChat;
}

export class SessionHost {
  private readonly liveChats = new Map<LiveChatId, LiveChat>();
  private hostFeed: Feed<HostState> | null = null;

  constructor(
    private readonly chats: HostChats,
    private readonly pickerCatalog: HostSliceSource<PickerCatalog>
  ) {}

  connect(connection: Connection): (frame: ClientFrame) => void {
    return (frame) => this.receive(connection, frame);
  }

  dispose(): void {
    for (const live of this.liveChats.values()) live.stopListening();
    this.liveChats.clear();
    this.hostFeed?.stopListening();
    this.hostFeed = null;
  }

  private receive(connection: Connection, frame: ClientFrame): void {
    if (frame.feed === "host") {
      if (frame.type === "subscribe") this.subscribeHost(connection);
      else if (this.hostFeed && leave(this.hostFeed, connection)) this.hostFeed = null;
      return;
    }
    switch (frame.type) {
      case "subscribe":
        this.subscribe(connection, frame.liveChatId);
        return;
      case "unsubscribe": {
        const live = this.liveChats.get(frame.liveChatId);
        if (live && leave(live, connection)) this.liveChats.delete(frame.liveChatId);
        return;
      }
    }
  }

  private subscribe(connection: Connection, liveChatId: LiveChatId): void {
    const live = this.liveChats.get(liveChatId) ?? this.open(liveChatId);
    if (!live) {
      connection({
        type: "snapshot",
        feed: "chat",
        liveChatId,
        seq: 0,
        state: EMPTY_SESSION_STATE,
      });
      return;
    }
    live.subscribers.add(connection);
    connection({ type: "snapshot", feed: "chat", liveChatId, seq: live.seq, state: live.state });
  }

  private subscribeHost(connection: Connection): void {
    const feed = this.hostFeed ?? this.openHost();
    feed.subscribers.add(connection);
    connection({ type: "snapshot", feed: "host", seq: feed.seq, state: feed.state });
  }

  private open(liveChatId: LiveChatId): LiveChat | null {
    const chat = this.chats.getSession(liveChatId);
    if (!chat) return null;
    const live: LiveChat = {
      chat,
      state: { usage: chat.getSessionUsage(), planUsage: chat.getPlanUsage() },
      seq: 0,
      subscribers: new Set(),
      stopListening: () => {},
    };
    // The chat batches its streaming notifications, so ops leave on that batch and no timer of the host's own. https://github.com/Brevilabs/obsidian-copilot-private/issues/609
    live.stopListening = chat.subscribe({
      onMessagesChanged: () => this.publish(liveChatId, live),
      onStatusChanged: () => {},
    });
    this.liveChats.set(liveChatId, live);
    return live;
  }

  private openHost(): Feed<HostState> {
    const feed: Feed<HostState> = {
      state: { pickerCatalog: this.pickerCatalog.read() },
      seq: 0,
      subscribers: new Set(),
      stopListening: () => {},
    };
    feed.stopListening = this.pickerCatalog.subscribe(() => this.publishHost(feed));
    this.hostFeed = feed;
    return feed;
  }

  private publish(liveChatId: LiveChatId, live: LiveChat): void {
    const ops: SessionOp[] = [];
    const usage = live.chat.getSessionUsage();
    if (usage !== live.state.usage) ops.push({ type: "slice", key: "usage", value: usage });
    const planUsage = live.chat.getPlanUsage();
    if (planUsage !== live.state.planUsage) {
      ops.push({ type: "slice", key: "planUsage", value: planUsage });
    }
    broadcast(live, ops, applySessionOp, (from) => ({
      type: "ops",
      feed: "chat",
      liveChatId,
      from,
      ops,
    }));
  }

  private publishHost(feed: Feed<HostState>): void {
    const pickerCatalog = this.pickerCatalog.read();
    if (pickerCatalog === feed.state.pickerCatalog) return;
    const ops: HostOp[] = [{ type: "slice", key: "pickerCatalog", value: pickerCatalog }];
    broadcast(feed, ops, applySliceOp, (from) => ({ type: "ops", feed: "host", from, ops }));
  }
}

function leave<S>(feed: Feed<S>, connection: Connection): boolean {
  feed.subscribers.delete(connection);
  if (feed.subscribers.size > 0) return false;
  feed.stopListening();
  return true;
}

function broadcast<S, O>(
  feed: Feed<S>,
  ops: O[],
  apply: (state: S, op: O) => S,
  toFrame: (from: number) => HostFrame
): void {
  if (ops.length === 0) return;
  const frame = toFrame(feed.seq + 1);
  feed.state = ops.reduce(apply, feed.state);
  feed.seq += ops.length;
  for (const connection of feed.subscribers) connection(frame);
}

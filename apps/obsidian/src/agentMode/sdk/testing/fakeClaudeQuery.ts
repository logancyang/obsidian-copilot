import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { SessionEvent, SessionUpdate } from "@/agentMode/session/types";
import { AsyncPushQueue } from "@/agentMode/sdk/asyncPushQueue";

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export class FakeClaudeQuery implements AsyncIterable<SDKMessage> {
  readonly inputs: SDKUserMessage[] = [];
  readonly interrupt = jest.fn(async () => undefined);
  readonly cancelAsyncMessage = jest.fn(async (_uuid: string) => false);
  readonly stopTask = jest.fn(async (_taskId: string) => undefined);
  readonly close = jest.fn(() => this.output.end());
  readonly setModel = jest.fn(async () => undefined);
  readonly setPermissionMode = jest.fn(async () => undefined);
  readonly applyFlagSettings = jest.fn(async () => undefined);
  readonly setMaxThinkingTokens = jest.fn(async () => undefined);
  private readonly output = new AsyncPushQueue<SDKMessage>();
  private readonly inputWaiters: Array<() => void> = [];
  private failure: Error | null = null;

  constructor(input: AsyncIterable<SDKUserMessage>) {
    void this.readInput(input);
  }

  async nextInput(index = this.inputs.length): Promise<SDKUserMessage> {
    while (this.inputs.length <= index) {
      await new Promise<void>((resolve) => this.inputWaiters.push(resolve));
    }
    return this.inputs[index];
  }

  emit(...frames: SDKMessage[]): void {
    for (const frame of frames) this.output.push(frame);
  }

  echo(input: SDKUserMessage): void {
    this.emit({ ...input, isReplay: true } as SDKMessage);
  }

  end(): void {
    this.output.end();
  }

  fail(error: Error): void {
    this.failure = error;
    this.output.end();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    for await (const frame of this.output) yield frame;
    if (this.failure !== null) throw this.failure;
  }

  private async readInput(input: AsyncIterable<SDKUserMessage>): Promise<void> {
    for await (const message of input) {
      this.inputs.push(message);
      for (const wake of this.inputWaiters.splice(0)) wake();
    }
  }
}

export class SessionEventRecorder {
  readonly events: SessionEvent[] = [];
  private readonly waiters: Array<{
    match: (update: SessionUpdate) => boolean;
    resolve: (update: SessionUpdate) => void;
  }> = [];

  readonly handler = (event: SessionEvent): void => {
    this.events.push(event);
    for (const waiter of [...this.waiters]) {
      if (!waiter.match(event.update)) continue;
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      waiter.resolve(event.update);
    }
  };

  updates(): SessionUpdate[] {
    return this.events.map((event) => event.update);
  }

  waitFor<K extends SessionUpdate["sessionUpdate"]>(
    kind: K,
    match: (update: Extract<SessionUpdate, { sessionUpdate: K }>) => boolean = () => true,
    seen = 0
  ): Promise<Extract<SessionUpdate, { sessionUpdate: K }>> {
    type Update = Extract<SessionUpdate, { sessionUpdate: K }>;
    const isMatch = (update: SessionUpdate): update is Update =>
      update.sessionUpdate === kind && match(update as Update);
    const already = this.updates().filter(isMatch);
    if (already.length > seen) return Promise.resolve(already[seen]);
    let skip = seen - already.length;
    return new Promise((resolve) => {
      this.waiters.push({
        match: (update) => isMatch(update) && skip-- === 0,
        resolve: (update) => resolve(update as Update),
      });
    });
  }
}

export function userEcho(uuid: string, text: string): SDKMessage {
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
    uuid: uuid as Uuid,
    session_id: "irrelevant",
    isReplay: true,
  };
}

export function textDelta(text: string, parentToolUseId: string | null = null): SDKMessage {
  return {
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    parent_tool_use_id: parentToolUseId,
    uuid: "uuid-delta" as Uuid,
    session_id: "irrelevant",
  };
}

export function resultFrame(overrides: Record<string, unknown> = {}): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: "ok",
    stop_reason: "end_turn",
    total_cost_usd: 0,
    usage: {},
    modelUsage: {},
    permission_denials: [],
    uuid: "uuid-result" as Uuid,
    session_id: "irrelevant",
    ...overrides,
  } as unknown as SDKMessage;
}

export function commandLifecycle(commandUuid: string, state: string): SDKMessage {
  return { type: "command_lifecycle", command_uuid: commandUuid, state } as unknown as SDKMessage;
}

export function systemInit(): SDKMessage {
  return { type: "system", subtype: "init", session_id: "irrelevant" } as unknown as SDKMessage;
}

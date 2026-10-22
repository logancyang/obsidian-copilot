import { AgentMessageStore } from "@/agentMode/session/AgentMessageStore";
import type { TurnPrompt, TurnTrackerDeps } from "@/agentMode/session/TurnTracker";

export interface FakeTurnTrackerDeps extends TurnTrackerDeps {
  store: AgentMessageStore;
  prompt: jest.MockedFunction<TurnTrackerDeps["prompt"]>;
  notifyMessages: jest.MockedFunction<TurnTrackerDeps["notifyMessages"]>;
  notifyQueuedPrompts: jest.MockedFunction<TurnTrackerDeps["notifyQueuedPrompts"]>;
  promptsWithdrawn: jest.MockedFunction<TurnTrackerDeps["promptsWithdrawn"]>;
  notifyStatus: jest.MockedFunction<TurnTrackerDeps["notifyStatus"]>;
  runningTaskToolCallIds: jest.MockedFunction<TurnTrackerDeps["runningTaskToolCallIds"]>;
  endLaunches: jest.MockedFunction<TurnTrackerDeps["endLaunches"]>;
  captureFileChanges: jest.MockedFunction<TurnTrackerDeps["captureFileChanges"]>;
  onTurnCompleted: jest.MockedFunction<TurnTrackerDeps["onTurnCompleted"]>;
  sentPrompts: TurnPrompt[];
  whenSent(promptId: string): Promise<void>;
  nextMessagesChange(): Promise<void>;
}

export function fakeTurnTrackerDeps(): FakeTurnTrackerDeps {
  const sentPrompts: TurnPrompt[] = [];
  const sentWaiters = new Map<string, () => void>();
  const messagesWaiters: Array<() => void> = [];
  return {
    store: new AgentMessageStore(),
    backendId: "claude",
    sentPrompts,
    prompt: jest.fn(async (input: TurnPrompt) => {
      sentPrompts.push(input);
      sentWaiters.get(input.promptId)?.();
    }),
    notifyMessages: jest.fn(() => {
      for (const resolve of messagesWaiters.splice(0)) resolve();
    }),
    notifyQueuedPrompts: jest.fn(),
    promptsWithdrawn: jest.fn(),
    notifyStatus: jest.fn(),
    runningTaskToolCallIds: jest.fn(() => new Set<string>()),
    endLaunches: jest.fn(),
    captureFileChanges: jest.fn<
      Promise<boolean>,
      Parameters<TurnTrackerDeps["captureFileChanges"]>
    >(async () => false),
    onTurnCompleted: jest.fn(),
    whenSent(promptId) {
      if (sentPrompts.some((p) => p.promptId === promptId)) return Promise.resolve();
      return new Promise((resolve) => sentWaiters.set(promptId, resolve));
    },
    nextMessagesChange() {
      return new Promise((resolve) => messagesWaiters.push(resolve));
    },
  };
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

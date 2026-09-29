import type { ClientFrame, ServerFrame } from "@/agentMode/protocol/frames";
import {
  INITIAL_HOST_STATE,
  type BackendSummary,
  type HostState,
  type TabSummary,
  type WireMessage,
} from "@/agentMode/protocol/state";

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function buildMessage(overrides: Partial<WireMessage> = {}): WireMessage {
  return {
    id: "m1",
    sender: "AI",
    timestamp: null,
    isVisible: true,
    message: "",
    parts: [],
    ...overrides,
  };
}

export function buildTab(overrides: Partial<TabSummary> = {}): TabSummary {
  return {
    id: "s1",
    chatInputId: "input-s1",
    backendId: "claude",
    projectId: "__global__",
    status: "idle",
    label: null,
    labelSource: null,
    needsAttention: false,
    canSwitchModel: true,
    canSwitchEffort: true,
    canSwitchMode: true,
    ...overrides,
  };
}

export function buildHostState(overrides: Partial<HostState> = {}): HostState {
  return { ...INITIAL_HOST_STATE, ...overrides };
}

export function buildBackendSummary(overrides: Partial<BackendSummary> = {}): BackendSummary {
  return {
    id: "claude",
    displayName: "Claude Code",
    readiness: "ready",
    preload: "ready",
    selfHostable: true,
    selfHostWarning: false,
    enabled: [],
    reported: [],
    efforts: {},
    defaultSelection: null,
    lockedPreview: [],
    ...overrides,
  };
}

export class FakeTransport {
  readonly sent: ClientFrame[] = [];
  private frameListeners = new Set<(frame: ServerFrame) => void>();
  private openListeners = new Set<(open: boolean) => void>();
  closed = false;

  send(frame: ClientFrame): void {
    this.sent.push(frame);
  }

  onFrame(cb: (frame: ServerFrame) => void): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  onOpenChange(cb: (open: boolean) => void): () => void {
    this.openListeners.add(cb);
    return () => this.openListeners.delete(cb);
  }

  close(): void {
    this.closed = true;
  }

  deliver(frame: ServerFrame): void {
    for (const cb of this.frameListeners) cb(frame);
  }

  setOpen(open: boolean): void {
    for (const cb of this.openListeners) cb(open);
  }

  sentOfType<T extends ClientFrame["type"]>(type: T) {
    return this.sent.filter((f) => f.type === type) as Extract<ClientFrame, { type: T }>[];
  }
}

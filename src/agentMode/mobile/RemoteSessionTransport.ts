import { parseServerFrame } from "@/agentMode/protocol/frameCodec";
import type { ClientFrame, ServerFrame } from "@/agentMode/protocol/frames";
import type { ClientTransport } from "@/agentMode/protocol/transport";
import type { ConnectOutcome } from "@/remote/client/RemoteClient";
import { CLOSE_CODE, type RemoteChannel } from "@/remote/wire";

// "offline": the desktop refused at once (Obsidian is closed on a machine that is up).
// "unreachable": it never answered (Tailscale off on either end, or the desktop asleep).
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
export type LinkFailure = "offline" | "unreachable" | "protocol";

export interface LinkState {
  phase: "connecting" | "open" | "retrying" | "denied" | "closed";
  failure: LinkFailure | null;
  attempts: number;
}

export interface VisibilitySource {
  isVisible(): boolean;
  subscribe(listener: () => void): () => void;
}

export interface RemoteSessionTransportDeps {
  connect: () => Promise<ConnectOutcome>;
  visibility: VisibilitySource;
  backoffMs?: readonly number[];
}

const STABLE_AFTER_MS = 5000;

// A desktop that speaks the protocol answers hello at once. One that accepts the connection and
// stays silent runs a Copilot without the session protocol, and the phone would otherwise wait
// on "Connecting" forever instead of asking for an update.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
export const FIRST_FRAME_TIMEOUT_MS = 8000;

export const DEFAULT_BACKOFF_MS: readonly number[] = [1000, 2000, 4000, 8000, 15000];

const INITIAL_STATE: LinkState = Object.freeze({
  phase: "connecting",
  failure: null,
  attempts: 0,
});

// iOS closes the socket about a second after the app leaves the foreground yet keeps reporting it
// open until the app returns, so every return to the foreground replaces the channel instead of
// trusting its state, and the client resumes each watched scope from its cursor. A command is never
// re-sent: the client fails an in-flight command with `disconnected`.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
export class RemoteSessionTransport implements ClientTransport {
  private state: LinkState = INITIAL_STATE;
  private channel: RemoteChannel | null = null;
  private generation = 0;
  private retryTimer: number | undefined;
  private stableTimer: number | undefined;
  private silenceTimer: number | undefined;
  private started = false;
  private readonly frameListeners = new Set<(frame: ServerFrame) => void>();
  private readonly openListeners = new Set<(open: boolean) => void>();
  private readonly linkListeners = new Set<() => void>();
  private stopVisibility: (() => void) | null = null;

  constructor(private readonly deps: RemoteSessionTransportDeps) {}

  getLinkState = (): LinkState => this.state;

  subscribeLink = (listener: () => void): (() => void) => {
    this.linkListeners.add(listener);
    return () => this.linkListeners.delete(listener);
  };

  start(): void {
    if (this.started || this.state.phase === "closed") return;
    this.started = true;
    this.stopVisibility = this.deps.visibility.subscribe(() => {
      if (this.deps.visibility.isVisible()) this.reconnectNow();
      else this.pauseRetries();
    });
    if (this.deps.visibility.isVisible()) this.dial();
  }

  // A desktop that rejected this phone stays rejected until the transport is recreated after
  // pairing again, so a retry has nothing to do in that state.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/613
  reconnectNow(): void {
    if (this.state.phase === "closed" || this.state.phase === "denied") return;
    this.dropChannel();
    this.dial();
  }

  send(frame: ClientFrame): void {
    this.channel?.send(JSON.stringify(frame));
  }

  onFrame(cb: (frame: ServerFrame) => void): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  onOpenChange(cb: (open: boolean) => void): () => void {
    this.openListeners.add(cb);
    if (this.state.phase === "open") cb(true);
    return () => this.openListeners.delete(cb);
  }

  close(): void {
    if (this.state.phase === "closed") return;
    this.stopVisibility?.();
    this.stopVisibility = null;
    this.dropChannel();
    this.setState({ ...this.state, phase: "closed" });
  }

  private pauseRetries(): void {
    window.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private setState(next: LinkState): void {
    this.state = next;
    for (const listener of [...this.linkListeners]) listener();
  }

  private setOpen(open: boolean): void {
    for (const listener of [...this.openListeners]) listener(open);
  }

  // Detaches the channel first so nothing it reports later reaches this transport, and bumps the
  // generation so an attempt still in flight closes its channel when it lands.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/613
  private dropChannel(): void {
    const channel = this.channel;
    this.generation += 1;
    this.channel = null;
    this.pauseRetries();
    window.clearTimeout(this.stableTimer);
    window.clearTimeout(this.silenceTimer);
    if (!channel) return;
    try {
      channel.close(1000);
    } catch {}
    if (this.state.phase === "open") this.setOpen(false);
  }

  private dial(): void {
    const generation = this.generation;
    this.setState({ ...this.state, phase: "connecting" });
    void this.deps.connect().then(
      (outcome) => this.handleOutcome(generation, outcome),
      () => this.handleOutcome(generation, { ok: false, reason: "protocol" })
    );
  }

  private handleOutcome(generation: number, outcome: ConnectOutcome): void {
    if (generation !== this.generation) {
      if (outcome.ok) outcome.channel.close(1000);
      return;
    }
    if (outcome.ok) {
      this.attach(outcome.channel);
      return;
    }
    if (outcome.reason === "token-rejected") {
      this.setState({ ...this.state, phase: "denied", failure: null });
      return;
    }
    const failure: LinkFailure =
      outcome.reason === "protocol" ? "protocol" : outcome.timedOut ? "unreachable" : "offline";
    this.scheduleRetry(failure);
  }

  private attach(channel: RemoteChannel): void {
    const generation = this.generation;
    this.channel = channel;
    channel.onMessage((text) => {
      if (generation !== this.generation) return;
      const frame = parseServerFrame(text);
      if (!frame) return;
      window.clearTimeout(this.silenceTimer);
      for (const listener of [...this.frameListeners]) listener(frame);
    });
    // A channel that closed before it was attached reports it here, at once, and `handleClosed`
    // has already decided what the link does next.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/613
    channel.onClose(({ code }) => this.handleClosed(generation, code));
    if (generation !== this.generation) return;
    this.setState({ ...this.state, phase: "open", failure: null });
    // A desktop that accepts the connection and drops it at once must not reset the backoff, or a
    // refusal loop would redial every second forever.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/613
    this.stableTimer = window.setTimeout(() => {
      if (generation === this.generation && this.state.attempts !== 0) {
        this.setState({ ...this.state, attempts: 0 });
      }
    }, STABLE_AFTER_MS);
    this.silenceTimer = window.setTimeout(() => {
      if (generation !== this.generation) return;
      this.dropChannel();
      this.scheduleRetry("protocol");
    }, FIRST_FRAME_TIMEOUT_MS);
    this.setOpen(true);
  }

  private handleClosed(generation: number, code: number): void {
    if (generation !== this.generation) return;
    this.channel = null;
    this.generation += 1;
    window.clearTimeout(this.stableTimer);
    window.clearTimeout(this.silenceTimer);
    if (this.state.phase === "open") this.setOpen(false);
    if (code === CLOSE_CODE.denied || code === CLOSE_CODE.revoked) {
      this.setState({ ...this.state, phase: "denied", failure: null });
      return;
    }
    this.scheduleRetry(null);
  }

  private scheduleRetry(failure: LinkFailure | null): void {
    const attempts = this.state.attempts + 1;
    this.setState({
      ...this.state,
      phase: "retrying",
      failure: failure ?? this.state.failure,
      attempts,
    });
    if (!this.deps.visibility.isVisible()) return;
    const schedule = this.deps.backoffMs ?? DEFAULT_BACKOFF_MS;
    const delay = schedule[Math.min(attempts - 1, schedule.length - 1)];
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = undefined;
      this.dial();
    }, delay);
  }
}

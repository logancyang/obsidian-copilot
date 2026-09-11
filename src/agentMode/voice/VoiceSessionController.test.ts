import { logInfo, logWarn } from "@/logger";
import { VoiceSessionController } from "@/agentMode/voice/VoiceSessionController";
import type {
  VoiceControlSocket,
  VoiceControlSocketHandlers,
  VoiceCreationRequest,
  VoiceHost,
  VoiceLiveConnectOptions,
  VoiceLiveConnection,
  VoiceMicrophone,
  VoicePlayback,
  VoiceSessionEvent,
} from "@/agentMode/voice/types";
import { VOICE_PROTOCOL_VERSION } from "@/agentMode/voice/voiceProtocol";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const CREDENTIAL = "tester-credential-value";
const TICKET = "one-use-control-ticket";
const CONVERSATION_ID = "conversation-1";
const VOICE_SESSION_ID = "vs_1";
const SDP_OFFER = "v=0\r\no=- offer";
const SDP_ANSWER = "v=0\r\no=- answer";

class FakeMicrophone implements VoiceMicrophone {
  readonly stream = { id: "capture" } as unknown as MediaStream;
  enabled: boolean | null = null;
  stopped = false;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  stop(): void {
    this.stopped = true;
  }
}

class FakeLiveConnection implements VoiceLiveConnection {
  microphoneStream: MediaStream | null = null;
  closed = false;
  answer: string | null = null;

  private readonly connected: Promise<void>;
  private markConnectCalled!: () => void;
  private options: VoiceLiveConnectOptions | null = null;
  private settle: { resolve: () => void; reject: (error: unknown) => void } | null = null;
  private remoteStreamHandler: ((stream: MediaStream) => void) | null = null;
  private channelHandler: ((event: never) => void) | null = null;

  constructor() {
    this.connected = new Promise<void>((resolve) => {
      this.markConnectCalled = resolve;
    });
  }

  addMicrophone(stream: MediaStream): void {
    this.microphoneStream = stream;
  }

  onRemoteStream(handler: (stream: MediaStream) => void): void {
    this.remoteStreamHandler = handler;
  }

  onEvent(handler: (event: never) => void): void {
    this.channelHandler = handler;
  }

  connect(options: VoiceLiveConnectOptions): Promise<void> {
    this.options = options;
    this.markConnectCalled();
    return new Promise<void>((resolve, reject) => {
      this.settle = { resolve, reject };
    });
  }

  close(): void {
    this.closed = true;
  }

  /** Runs the SDP exchange the way the SDK helper does during negotiation. */
  async negotiate(): Promise<void> {
    await this.connected;
    const options = this.options;
    if (!options) throw new Error("connect() was never called");
    try {
      this.answer = await options.exchangeSdp(SDP_OFFER, { signal: new AbortController().signal });
    } catch (error) {
      this.settle?.reject(error);
    }
  }

  /** Reports that media and the event channel became usable. */
  finishConnecting(): void {
    this.settle?.resolve();
  }

  /** Reports a negotiation failure the helper would surface from connect(). */
  failConnecting(error: Error): void {
    this.settle?.reject(error);
  }

  deliverRemoteStream(stream: MediaStream): void {
    this.remoteStreamHandler?.(stream);
  }

  /** Delivers one `oai-events` event, as the data channel would. */
  deliverChannelEvent(event: Record<string, unknown>): void {
    this.channelHandler?.(event as never);
  }

  /** Reports that the live session became usable. */
  deliverSessionStarted(): void {
    this.deliverChannelEvent({ type: "session.started", event_id: "live-started" });
  }
}

class FakeControlSocket implements VoiceControlSocket {
  readonly sent: string[] = [];
  closed = false;

  constructor(
    readonly url: string,
    readonly handlers: VoiceControlSocketHandlers
  ) {}

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.handlers.onClose();
  }

  /** Delivers one server frame as the real socket would. */
  deliver(event: Record<string, unknown>): void {
    this.handlers.onMessage(JSON.stringify(event));
  }

  framesOfType(type: string): Array<Record<string, unknown>> {
    return this.sent
      .map((payload) => JSON.parse(payload) as Record<string, unknown>)
      .filter((frame) => frame.type === type);
  }

  lastFrame(): Record<string, unknown> {
    return JSON.parse(this.sent[this.sent.length - 1]) as Record<string, unknown>;
  }
}

interface Harness {
  controller: VoiceSessionController;
  microphone: FakeMicrophone;
  connection: FakeLiveConnection;
  playback: VoicePlayback & { play: jest.Mock; stop: jest.Mock };
  creations: VoiceCreationRequest[];
  sockets: FakeControlSocket[];
  events: VoiceSessionEvent[];
  socket(): FakeControlSocket;
  /** Acknowledges the client frame at `index`, as the server does on receipt. */
  ack(index: number, seq?: number): void;
  serverFrame(frame: Record<string, unknown>): Record<string, unknown>;
}

function createHarness(
  options: {
    sdpAnswer?: string | null;
    serverUrl?: string;
    enabled?: boolean;
    credential?: string | null;
  } = {}
): Harness {
  const microphone = new FakeMicrophone();
  const connection = new FakeLiveConnection();
  const playback = { play: jest.fn(), stop: jest.fn() };
  const creations: VoiceCreationRequest[] = [];
  const sockets: FakeControlSocket[] = [];
  const events: VoiceSessionEvent[] = [];
  let nextId = 0;

  const host: VoiceHost = {
    timers: {
      setTimeout: (handler, ms) => window.setTimeout(handler, ms),
      clearTimeout: (id) => window.clearTimeout(id),
    },
    captureMicrophone: () => Promise.resolve(microphone),
    createLiveConnection: () => connection,
    createPlayback: () => playback,
    createSession: (request) => {
      creations.push(request);
      return Promise.resolve({
        voiceSessionId: VOICE_SESSION_ID,
        sdpAnswer: options.sdpAnswer === undefined ? SDP_ANSWER : options.sdpAnswer,
        controlTicket: TICKET,
        expiresAt: "2026-09-10T00:00:30.000Z",
        limits: { maxSessionSeconds: 600, warnAtSeconds: 540 },
      });
    },
    openControlSocket: (url, handlers) => {
      const socket = new FakeControlSocket(url, handlers);
      sockets.push(socket);
      return socket;
    },
  };

  const controller = new VoiceSessionController({
    host,
    readSettings: () => ({
      enabled: options.enabled ?? true,
      serverUrl: options.serverUrl ?? "https://voice.example.com",
    }),
    resolveCredential: () => (options.credential === undefined ? CREDENTIAL : options.credential),
    newEventId: () => `ev-${++nextId}`,
    now: () => 1_000,
  });
  controller.subscribe((event) => events.push(event));

  const harness: Harness = {
    controller,
    microphone,
    connection,
    playback,
    creations,
    sockets,
    events,
    socket: () => sockets[0],
    ack: (index, seq = index + 1) => {
      const frame = JSON.parse(sockets[0].sent[index]) as { eventId: string };
      sockets[0].deliver(harness.serverFrame({ type: "ack", ackEventId: frame.eventId, seq }));
    },
    serverFrame: (frame) => ({
      protocolVersion: VOICE_PROTOCOL_VERSION,
      eventId: `srv-${Math.random().toString(16).slice(2)}`,
      conversationId: CONVERSATION_ID,
      voiceSessionId: VOICE_SESSION_ID,
      seq: 1,
      ...frame,
    }),
  };
  return harness;
}

const START_REQUEST = {
  conversationId: CONVERSATION_ID,
  backendDisplayName: "opencode",
  startupContext: [{ role: "user" as const, content: "What are my launch risks?" }],
};

/** Runs negotiation, control authentication, and media readiness in one step. */
async function connect(harness: Harness): Promise<void> {
  const started = harness.controller.start(START_REQUEST);
  await harness.connection.negotiate();
  harness.socket().handlers.onOpen();
  harness.ack(0);
  harness.connection.finishConnecting();
  harness.connection.deliverSessionStarted();
  await started;
}

describe("VoiceSessionController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("start()", () => {
    it("becomes active when media starts before the control socket authenticates", async () => {
      const harness = createHarness();

      const started = harness.controller.start(START_REQUEST);
      await harness.connection.negotiate();
      harness.connection.finishConnecting();
      harness.connection.deliverSessionStarted();
      harness.socket().handlers.onOpen();
      harness.ack(0);
      await started;

      expect(harness.controller.getSnapshot().state).toBe("active");
      expect(harness.controller.getSnapshot().voiceSessionId).toBe(VOICE_SESSION_ID);
    });

    it("becomes active when the control socket authenticates before media starts", async () => {
      const harness = createHarness();

      const started = harness.controller.start(START_REQUEST);
      await harness.connection.negotiate();
      harness.socket().handlers.onOpen();
      harness.ack(0);
      harness.connection.finishConnecting();
      harness.connection.deliverSessionStarted();
      await started;

      expect(harness.controller.getSnapshot().state).toBe("active");
    });

    it("keeps the microphone silenced until the live session reports session.started", async () => {
      const harness = createHarness();

      const started = harness.controller.start(START_REQUEST);
      await harness.connection.negotiate();
      harness.socket().handlers.onOpen();
      harness.ack(0);
      harness.connection.finishConnecting();
      await Promise.resolve();

      expect(harness.controller.getSnapshot().state).toBe("connecting");
      expect(harness.microphone.enabled).toBe(false);

      harness.connection.deliverSessionStarted();
      await started;

      expect(harness.microphone.enabled).toBe(true);
      expect(harness.connection.microphoneStream).toBe(harness.microphone.stream);
    });

    it("fails the call when the live session never reports that it started", async () => {
      jest.useFakeTimers();
      try {
        const harness = createHarness();

        const started = harness.controller.start(START_REQUEST);
        await harness.connection.negotiate();
        harness.socket().handlers.onOpen();
        harness.ack(0);
        harness.connection.finishConnecting();
        await Promise.resolve();
        jest.advanceTimersByTime(15_000);

        await expect(started).rejects.toThrow("never reported that it started");
        expect(harness.controller.getSnapshot().state).toBe("error");
        expect(harness.microphone.stopped).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it("sends the SDP offer to the configured creation endpoint with bearer authentication", async () => {
      const harness = createHarness();

      await connect(harness);

      expect(harness.creations).toHaveLength(1);
      const [creation] = harness.creations;
      expect(creation.url).toBe("https://voice.example.com/v1/voice/sessions");
      expect(creation.credential).toBe(CREDENTIAL);
      expect(JSON.parse(creation.body)).toMatchObject({
        conversationId: CONVERSATION_ID,
        backendDisplayName: "opencode",
        sdpOffer: SDP_OFFER,
        startupContext: [{ role: "user", content: "What are my launch risks?" }],
      });
      expect(harness.socket().url).toBe(
        `wss://voice.example.com/v1/voice/sessions/${VOICE_SESSION_ID}/control`
      );
    });

    it("authenticates the control socket with the one-use ticket in its first frame", async () => {
      const harness = createHarness();

      await connect(harness);

      const [first] = harness.socket().sent.map((p) => JSON.parse(p) as Record<string, unknown>);
      expect(first).toMatchObject({ type: "auth", ticket: TICKET, protocolVersion: 1 });
    });

    it("runs control-only and releases the microphone when the server returns no SDP answer", async () => {
      const harness = createHarness({ sdpAnswer: null });

      const started = harness.controller.start(START_REQUEST);
      await harness.connection.negotiate();
      harness.socket().handlers.onOpen();
      harness.ack(0);
      await started;

      expect(harness.controller.getSnapshot()).toMatchObject({
        state: "active",
        controlOnly: true,
      });
      expect(harness.microphone.stopped).toBe(true);
    });

    it("plays remote audio in the owning window and exposes its stream", async () => {
      const harness = createHarness();
      const remote = { id: "remote" } as unknown as MediaStream;

      await connect(harness);
      harness.connection.deliverRemoteStream(remote);

      expect(harness.playback.play).toHaveBeenCalledWith(remote);
      expect(harness.controller.getRemoteStream()).toBe(remote);
      expect(harness.controller.getSnapshot().playbackActive).toBe(true);
    });

    it("refuses to open a call when no credential is stored", async () => {
      const harness = createHarness({ credential: null });

      await expect(harness.controller.start(START_REQUEST)).rejects.toThrow(
        "credential is not configured"
      );
      expect(harness.creations).toHaveLength(0);
    });

    it("refuses to open a call when the server URL is blank", async () => {
      const harness = createHarness({ serverUrl: "   " });

      await expect(harness.controller.start(START_REQUEST)).rejects.toThrow(
        "server URL is not configured"
      );
    });

    it("refuses to open a call while voice is turned off in settings", async () => {
      const harness = createHarness({ enabled: false });

      await expect(harness.controller.start(START_REQUEST)).rejects.toThrow("turned off");
    });

    it("reports an error state and releases the microphone when negotiation fails", async () => {
      const harness = createHarness();

      const started = harness.controller.start(START_REQUEST);
      await harness.connection.negotiate();
      harness.connection.failConnecting(new Error("ICE failed"));

      await expect(started).rejects.toThrow("ICE failed");
      expect(harness.controller.getSnapshot().state).toBe("error");
      expect(harness.microphone.stopped).toBe(true);
      expect(harness.connection.closed).toBe(true);
    });

    it("rejects a second call while one is already running", async () => {
      const harness = createHarness();
      await connect(harness);

      await expect(harness.controller.start(START_REQUEST)).rejects.toThrow("already running");
    });

    it("keeps the credential, ticket, and SDP out of the log", async () => {
      const harness = createHarness();

      await connect(harness);

      const logged = JSON.stringify([
        ...jest.mocked(logInfo).mock.calls,
        ...jest.mocked(logWarn).mock.calls,
      ]);
      expect(logged).not.toContain(CREDENTIAL);
      expect(logged).not.toContain(TICKET);
      expect(logged).not.toContain("v=0");
    });
  });

  describe("setMuted()", () => {
    it("silences capture immediately without stopping the track that carries media", async () => {
      const harness = createHarness();
      await connect(harness);

      harness.controller.setMuted(true);

      expect(harness.microphone.enabled).toBe(false);
      expect(harness.microphone.stopped).toBe(false);
      expect(harness.controller.getSnapshot()).toMatchObject({
        locallyMuted: true,
        inputCommandPending: true,
      });
      expect(harness.socket().lastFrame()).toMatchObject({ type: "input.mute" });
    });

    it("clears the pending flag once the provider reports the microphone muted", async () => {
      const harness = createHarness();
      await connect(harness);

      harness.controller.setMuted(true);
      harness.ack(harness.socket().sent.length - 1);
      harness.connection.deliverChannelEvent({
        type: "session.input_audio.muted",
        event_id: "live-muted-1",
      });

      expect(harness.controller.getSnapshot()).toMatchObject({
        locallyMuted: true,
        inputCommandPending: false,
      });
    });

    it("keeps capture off until the provider reports the microphone unmuted", async () => {
      const harness = createHarness();
      await connect(harness);
      harness.controller.setMuted(true);
      harness.ack(harness.socket().sent.length - 1);

      harness.controller.setMuted(false);
      harness.ack(harness.socket().sent.length - 1);

      expect(harness.microphone.enabled).toBe(false);
      expect(harness.controller.getSnapshot()).toMatchObject({
        locallyMuted: true,
        inputCommandPending: true,
      });
      expect(harness.socket().lastFrame()).toMatchObject({ type: "input.unmute" });

      harness.connection.deliverChannelEvent({
        type: "session.input_audio.unmuted",
        event_id: "live-unmuted-1",
      });

      expect(harness.microphone.enabled).toBe(true);
      expect(harness.controller.getSnapshot()).toMatchObject({
        locallyMuted: false,
        inputCommandPending: false,
      });
    });

    it("leaves capture off when the provider refuses the unmute", async () => {
      const harness = createHarness();
      await connect(harness);
      harness.controller.setMuted(true);
      harness.ack(harness.socket().sent.length - 1);

      harness.controller.setMuted(false);
      harness.ack(harness.socket().sent.length - 1);
      harness.socket().deliver(
        harness.serverFrame({
          type: "error",
          code: "upstream-failed",
          recoverable: true,
          detail: "input command was rejected upstream",
        })
      );

      expect(harness.microphone.enabled).toBe(false);
      expect(harness.controller.getSnapshot()).toMatchObject({
        locallyMuted: true,
        inputCommandPending: false,
      });
    });

    it("resumes capture on the acknowledgment alone when the provider never reports the outcome", async () => {
      jest.useFakeTimers();
      try {
        const harness = createHarness();
        await connect(harness);
        harness.controller.setMuted(true);
        harness.ack(harness.socket().sent.length - 1);

        harness.controller.setMuted(false);
        harness.ack(harness.socket().sent.length - 1);
        expect(harness.microphone.enabled).toBe(false);

        jest.advanceTimersByTime(1_500);

        expect(harness.microphone.enabled).toBe(true);
        expect(harness.controller.getSnapshot()).toMatchObject({
          locallyMuted: false,
          inputCommandPending: false,
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it("records the preference without a server command before the call is connected", () => {
      const harness = createHarness();

      harness.controller.setMuted(true);

      expect(harness.controller.getSnapshot()).toMatchObject({
        locallyMuted: true,
        inputCommandPending: false,
      });
      expect(harness.sockets).toHaveLength(0);
    });
  });

  describe("close()", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("stops capture and playback while the channels stay up for the terminal frame", async () => {
      const harness = createHarness();
      await connect(harness);
      harness.connection.deliverRemoteStream({ id: "remote" } as unknown as MediaStream);

      const closed = harness.controller.close("done");
      await Promise.resolve();

      expect(harness.socket().framesOfType("session.close")).toHaveLength(1);
      expect(harness.microphone.stopped).toBe(true);
      expect(harness.playback.stop).toHaveBeenCalled();
      expect(harness.controller.getSnapshot().state).toBe("closing");
      expect(harness.socket().closed).toBe(false);
      expect(harness.connection.closed).toBe(false);

      harness.socket().deliver(
        harness.serverFrame({
          type: "session.closed",
          reason: "client-requested",
          usage: { connectedSeconds: 3, estimatedCostUsd: 0.0025, source: "local-clock" },
          usageFinal: false,
        })
      );
      await closed;
    });

    it("confirms closure when session.closed arrives within the wait", async () => {
      const harness = createHarness();
      await connect(harness);

      const closed = harness.controller.close();
      await Promise.resolve();
      harness.socket().deliver(
        harness.serverFrame({
          type: "session.closed",
          reason: "client-requested",
          usage: { connectedSeconds: 3, estimatedCostUsd: 0.0025, source: "local-clock" },
          usageFinal: true,
        })
      );
      await closed;

      expect(harness.controller.getSnapshot()).toMatchObject({
        state: "off",
        closureConfirmed: true,
        closeReason: "client-requested",
      });
      expect(harness.socket().closed).toBe(true);
      expect(harness.connection.closed).toBe(true);
    });

    it("reports uncertain closure when no terminal frame arrives within five seconds", async () => {
      const harness = createHarness();
      await connect(harness);

      const closed = harness.controller.close();
      await Promise.resolve();
      jest.advanceTimersByTime(5_000);
      await closed;

      expect(harness.controller.getSnapshot()).toMatchObject({
        state: "off",
        closureConfirmed: false,
        closeReason: null,
      });
      expect(harness.socket().closed).toBe(true);
    });

    it("joins the closure already in flight instead of asking the server twice", async () => {
      const harness = createHarness();
      await connect(harness);

      const first = harness.controller.close();
      const second = harness.controller.close();
      await Promise.resolve();
      jest.advanceTimersByTime(5_000);
      await Promise.all([first, second]);

      expect(harness.socket().framesOfType("session.close")).toHaveLength(1);
    });

    it("does nothing when no call was ever opened", async () => {
      const harness = createHarness();

      await harness.controller.close();

      expect(harness.controller.getSnapshot().state).toBe("off");
    });
  });

  describe("subscribe()", () => {
    it("publishes each transcript fragment once, preserving its text and time range", async () => {
      const harness = createHarness();
      await connect(harness);
      const fragment = {
        type: "session.input_transcript.delta",
        event_id: "live-ev-1",
        delta: "  focus on the ",
        start_ms: 1_200,
        end_ms: 1_800,
      };

      harness.connection.deliverChannelEvent(fragment);
      harness.connection.deliverChannelEvent(fragment);

      const transcripts = harness.events.filter((event) => event.type === "transcript.delta");
      expect(transcripts).toEqual([
        {
          type: "transcript.delta",
          delta: {
            voiceSessionId: VOICE_SESSION_ID,
            liveEventId: "live-ev-1",
            role: "user",
            delta: "  focus on the ",
            startMs: 1_200,
            endMs: 1_800,
          },
        },
      ]);
    });

    it("labels output transcript fragments as assistant speech", async () => {
      const harness = createHarness();
      await connect(harness);

      harness.connection.deliverChannelEvent({
        type: "session.output_transcript.delta",
        event_id: "live-ev-2",
        delta: "I'll look through your notes.",
        start_ms: 2_000,
        end_ms: 2_400,
      });

      const [transcript] = harness.events.filter((event) => event.type === "transcript.delta");
      expect(transcript).toMatchObject({ delta: { role: "assistant" } });
    });

    it("publishes the delegation request the server relays, without inventing task text", async () => {
      const harness = createHarness();
      await connect(harness);

      harness.socket().deliver(
        harness.serverFrame({
          type: "delegation.requested",
          liveDelegationId: "live-delegation-1",
          offsetMs: 4_200,
        })
      );

      expect(harness.events).toContainEqual({
        type: "delegation.requested",
        liveDelegationId: "live-delegation-1",
        offsetMs: 4_200,
      });
    });

    it("publishes the deadline warning and the usage snapshot that replaces earlier ones", async () => {
      const harness = createHarness();
      await connect(harness);
      const usage = {
        connectedSeconds: 540,
        estimatedCostUsd: 0.45,
        source: "local-clock" as const,
      };

      harness.socket().deliver(
        harness.serverFrame({
          type: "session.warning",
          reason: "deadline-approaching",
          secondsRemaining: 60,
        })
      );
      harness.socket().deliver(harness.serverFrame({ type: "usage.updated", usage }));

      expect(harness.events).toContainEqual({ type: "session.warning", secondsRemaining: 60 });
      expect(harness.controller.getSnapshot().usage).toEqual(usage);
    });

    it("ends the call locally when the server closes it on its own deadline", async () => {
      const harness = createHarness();
      await connect(harness);

      harness.socket().deliver(
        harness.serverFrame({
          type: "session.closed",
          reason: "deadline",
          usage: { connectedSeconds: 600, estimatedCostUsd: 0.5, source: "local-clock" },
          usageFinal: true,
        })
      );

      expect(harness.controller.getSnapshot()).toMatchObject({
        state: "off",
        closeReason: "deadline",
      });
      expect(harness.connection.closed).toBe(true);
    });

    it("answers the server's liveness probe without changing the snapshot", async () => {
      const harness = createHarness();
      await connect(harness);
      const before = harness.controller.getSnapshot();

      harness.socket().deliver(harness.serverFrame({ type: "ping" }));

      expect(harness.socket().framesOfType("pong")).toHaveLength(1);
      expect(harness.controller.getSnapshot()).toBe(before);
    });

    it("discards a frame addressed to another voice session", async () => {
      const harness = createHarness();
      await connect(harness);
      const before = harness.controller.getSnapshot();

      harness.socket().deliver({
        protocolVersion: VOICE_PROTOCOL_VERSION,
        eventId: "srv-x",
        conversationId: CONVERSATION_ID,
        voiceSessionId: "vs_other",
        seq: 9,
        type: "delegation.requested",
        liveDelegationId: "live-delegation-2",
        offsetMs: 10,
      });

      expect(harness.events).not.toContainEqual(
        expect.objectContaining({ type: "delegation.requested" })
      );
      expect(harness.controller.getSnapshot()).toBe(before);
    });

    it("stops delivering events to a listener that unsubscribed", async () => {
      const harness = createHarness();
      const seen: VoiceSessionEvent[] = [];
      const unsubscribe = harness.controller.subscribe((event) => seen.push(event));

      unsubscribe();
      await connect(harness);

      expect(seen).toHaveLength(0);
    });
  });

  describe("acceptDelegation()", () => {
    it("maps the delegation to a local task on the control socket", async () => {
      const harness = createHarness();
      await connect(harness);

      harness.controller.acceptDelegation("live-delegation-1", "task-7");

      expect(harness.socket().lastFrame()).toMatchObject({
        type: "delegation.accepted",
        liveDelegationId: "live-delegation-1",
        taskId: "task-7",
        conversationId: CONVERSATION_ID,
        voiceSessionId: VOICE_SESSION_ID,
      });
    });

    it("drops the event and warns when the control socket is not authenticated", () => {
      const harness = createHarness();

      harness.controller.acceptDelegation("live-delegation-1", "task-7");

      expect(harness.sockets).toHaveLength(0);
      expect(jest.mocked(logWarn)).toHaveBeenCalled();
    });
  });

  describe("deferDelegation()", () => {
    it("reports the reason no task was created", async () => {
      const harness = createHarness();
      await connect(harness);

      harness.controller.deferDelegation("live-delegation-1", "no-transcript");

      expect(harness.socket().lastFrame()).toMatchObject({
        type: "delegation.deferred",
        liveDelegationId: "live-delegation-1",
        reason: "no-transcript",
      });
    });
  });

  describe("updateTask()", () => {
    it("sends the task state, revision, and bounded excerpt", async () => {
      const harness = createHarness();
      await connect(harness);

      harness.controller.updateTask({
        taskId: "task-7",
        revision: 2,
        state: "completed",
        excerpt: "Three notes mention onboarding risk.",
        liveDelegationId: "live-delegation-1",
      });

      expect(harness.socket().lastFrame()).toMatchObject({
        type: "task.updated",
        taskId: "task-7",
        revision: 2,
        state: "completed",
        excerpt: "Three notes mention onboarding risk.",
      });
    });
  });

  describe("updateContext()", () => {
    it("mirrors an accepted typed submission and current facts", async () => {
      const harness = createHarness();
      await connect(harness);

      harness.controller.updateContext({
        submission: { submissionId: "sub-1", taskId: "task-8", requestText: "Focus on pricing." },
        facts: ["One task is running."],
      });

      expect(harness.socket().lastFrame()).toMatchObject({
        type: "context.updated",
        submission: { submissionId: "sub-1", taskId: "task-8", requestText: "Focus on pricing." },
        facts: ["One task is running."],
      });
    });
  });
});

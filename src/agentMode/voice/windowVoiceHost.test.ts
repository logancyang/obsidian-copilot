import * as obsidianModule from "obsidian";
import { OpenAILiveWebRTC } from "openai-live/lib/live/webrtc";
import { createWindowVoiceHost } from "@/agentMode/voice/windowVoiceHost";
import type { VoiceControlSocketHandlers } from "@/agentMode/voice/types";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

// The SDK helper builds a real `RTCPeerConnection`, which jsdom does not
// implement; the adapter around it is exercised through this stand-in.
jest.mock("openai-live/lib/live/webrtc", () => ({
  OpenAILiveWebRTC: jest.fn().mockImplementation(() => ({
    peerConnection: { addTrack: jest.fn(), addEventListener: jest.fn() },
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn(),
  })),
}));

/** The obsidian mock's seam for stubbing `requestUrl` per test. */
const { __setRequestUrlImpl } = obsidianModule as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};

class FakeSocket {
  readonly listeners = new Map<string, () => void>();
  readonly sent: string[] = [];
  closed = false;

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.closed = true;
  }
}

interface FakeTrack {
  enabled: boolean;
  stopped: boolean;
  stop(): void;
}

interface OwnerWindowStub {
  window: Window;
  sockets: FakeSocket[];
  audioElements: HTMLAudioElement[];
  track: FakeTrack;
  stream: MediaStream;
}

function createOwnerWindow(): OwnerWindowStub {
  const sockets: FakeSocket[] = [];
  const audioElements: HTMLAudioElement[] = [];
  const track: FakeTrack = {
    enabled: true,
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;

  const ownerWindow = {
    navigator: { mediaDevices: { getUserMedia: jest.fn().mockResolvedValue(stream) } },
    document: {
      body: {
        createEl: (_tag: string, _info: unknown, callback?: (el: HTMLAudioElement) => void) => {
          const element = {
            autoplay: false,
            srcObject: null as MediaStream | null,
            play: jest.fn().mockResolvedValue(undefined),
            pause: jest.fn(),
            remove: jest.fn(),
          } as unknown as HTMLAudioElement;
          callback?.(element);
          audioElements.push(element);
          return element;
        },
      },
    },
    WebSocket: function FakeWebSocket(url: string) {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    setTimeout: jest.fn(() => 42),
    clearTimeout: jest.fn(),
  } as unknown as Window;

  return { window: ownerWindow, sockets, audioElements, track, stream };
}

const HANDLERS: VoiceControlSocketHandlers = {
  onOpen: jest.fn(),
  onMessage: jest.fn(),
  onClose: jest.fn(),
  onError: jest.fn(),
};

describe("windowVoiceHost", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createWindowVoiceHost()", () => {
    it("captures the microphone from the owning window and can silence it without releasing it", async () => {
      const owner = createOwnerWindow();

      const microphone = await createWindowVoiceHost(owner.window).captureMicrophone();
      microphone.setEnabled(false);

      expect(owner.window.navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        audio: true,
      });
      expect(owner.track.enabled).toBe(false);
      expect(owner.track.stopped).toBe(false);

      microphone.stop();
      expect(owner.track.stopped).toBe(true);
    });

    it("offers the captured audio track to the peer connection and subscribes to every event it needs, but not to audio frames", () => {
      const owner = createOwnerWindow();

      const connection = createWindowVoiceHost(owner.window).createLiveConnection();
      connection.addMicrophone(owner.stream);
      connection.onEvent(() => undefined);

      const helper = jest.mocked(OpenAILiveWebRTC).mock.results[0].value as {
        peerConnection: { addTrack: jest.Mock };
        on: jest.Mock;
      };
      expect(helper.peerConnection.addTrack).toHaveBeenCalledWith(owner.track, owner.stream);
      expect(helper.on.mock.calls.map(([type]) => type)).toEqual([
        "session.started",
        "session.input_transcript.delta",
        "session.output_transcript.delta",
        "session.input_audio.muted",
        "session.input_audio.unmuted",
      ]);
    });

    it("plays remote audio from an element in the owning window's document", () => {
      const owner = createOwnerWindow();
      const remote = { id: "remote" } as unknown as MediaStream;

      const playback = createWindowVoiceHost(owner.window).createPlayback();
      playback.play(remote);

      expect(owner.audioElements).toHaveLength(1);
      expect(owner.audioElements[0].srcObject).toBe(remote);
      expect(owner.audioElements[0].autoplay).toBe(true);

      playback.stop();
      expect(owner.audioElements[0].remove).toHaveBeenCalled();
    });

    it("measures remote samples in the owning window and releases the meter on stop", () => {
      const owner = createOwnerWindow();
      let sample = 0.5;
      let frame: FrameRequestCallback | undefined;
      const analyser = {
        fftSize: 0,
        getFloatTimeDomainData: (samples: Float32Array) => samples.fill(sample),
        disconnect: jest.fn(),
      };
      const source = { connect: jest.fn(), disconnect: jest.fn() };
      const context = {
        createAnalyser: () => analyser,
        createMediaStreamSource: jest.fn(() => source),
        close: jest.fn().mockResolvedValue(undefined),
        resume: jest.fn().mockResolvedValue(undefined),
      };
      Object.assign(owner.window, {
        AudioContext: jest.fn(() => context),
        requestAnimationFrame: jest.fn((callback) => {
          frame = callback;
          return 12;
        }),
        cancelAnimationFrame: jest.fn(),
      });
      const levels = jest.fn();
      const playback = createWindowVoiceHost(owner.window).createPlayback(levels);
      playback.play(owner.stream);
      frame?.(100);
      expect(levels).toHaveBeenLastCalledWith(0.5);
      sample = 2;
      frame?.(125);
      expect(levels).toHaveBeenLastCalledWith(0.5);
      frame?.(150);
      expect(levels).toHaveBeenLastCalledWith(1);
      sample = 0;
      frame?.(200);
      expect(levels).toHaveBeenLastCalledWith(0);
      expect(context.createMediaStreamSource).toHaveBeenCalledWith(owner.stream);
      playback.stop();
      expect(owner.window.cancelAnimationFrame).toHaveBeenCalledWith(12);
      expect(source.disconnect).toHaveBeenCalled();
      expect(analyser.disconnect).toHaveBeenCalled();
      expect(context.close).toHaveBeenCalledTimes(1);
      expect(levels).toHaveBeenLastCalledWith(0);
      playback.stop();
      expect(context.close).toHaveBeenCalledTimes(1);
      levels.mockClear();
      frame?.(300);
      expect(levels).not.toHaveBeenCalled();
    });

    it("keeps playback working with a flat meter when audio analysis cannot initialize", () => {
      const owner = createOwnerWindow();
      Object.assign(owner.window, {
        AudioContext: jest.fn(() => {
          throw new Error("unavailable");
        }),
      });
      const levels = jest.fn();
      const playback = createWindowVoiceHost(owner.window).createPlayback(levels);
      playback.play(owner.stream);
      expect(owner.audioElements[0].play).toHaveBeenCalled();
      expect(levels).toHaveBeenLastCalledWith(0);
      playback.stop();
      expect(owner.audioElements[0].remove).toHaveBeenCalled();
    });

    it("opens the control socket in the owning window and forwards its frames", () => {
      const owner = createOwnerWindow();

      const socket = createWindowVoiceHost(owner.window).openControlSocket(
        "wss://voice.example.com/v1/voice/sessions/vs_1/control",
        HANDLERS
      );
      socket.send("{}");

      expect(owner.sockets).toHaveLength(1);
      expect(owner.sockets[0].url).toBe("wss://voice.example.com/v1/voice/sessions/vs_1/control");
      expect(owner.sockets[0].sent).toEqual(["{}"]);

      socket.close();
      expect(owner.sockets[0].closed).toBe(true);
    });

    it("creates the session over Obsidian's request path with a bearer credential", async () => {
      const owner = createOwnerWindow();
      const requestUrl = jest
        .fn()
        .mockResolvedValue({ status: 201, json: { voiceSessionId: "vs_1" } });
      __setRequestUrlImpl(requestUrl);

      const body = await createWindowVoiceHost(owner.window).createSession({
        url: "https://voice.example.com/v1/voice/sessions",
        credential: "tester-credential",
        body: '{"conversationId":"c1"}',
      });

      expect(requestUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://voice.example.com/v1/voice/sessions",
          method: "POST",
          headers: { Authorization: "Bearer tester-credential" },
          body: '{"conversationId":"c1"}',
        })
      );
      expect(body).toEqual({ voiceSessionId: "vs_1" });
    });

    it("fails with the status code when the server refuses the session", async () => {
      const owner = createOwnerWindow();
      __setRequestUrlImpl(jest.fn().mockResolvedValue({ status: 401, json: undefined }));

      await expect(
        createWindowVoiceHost(owner.window).createSession({
          url: "https://voice.example.com/v1/voice/sessions",
          credential: "wrong",
          body: "{}",
        })
      ).rejects.toThrow("HTTP 401");
    });

    it("schedules waits on the owning window's timers", () => {
      const owner = createOwnerWindow();

      const host = createWindowVoiceHost(owner.window);
      const id = host.timers.setTimeout(() => undefined, 5_000);
      host.timers.clearTimeout(id);

      expect(owner.window.setTimeout).toHaveBeenCalledWith(expect.any(Function), 5_000);
      expect(owner.window.clearTimeout).toHaveBeenCalledWith(42);
    });
  });
});

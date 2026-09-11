import { requestUrl } from "obsidian";
// `openai-live` is `openai@7` under an alias. The live WebRTC helper only
// exists in 7.x, but raising the plugin's own `openai` dependency to 7 adds
// ~200 KB to the bundle — past the ceiling Obsidian Sync imposes on `main.js`
// — because LangChain's client is bundled from it too. Importing this one
// helper from the alias keeps the chat client on `openai@6` and leaves the
// rest of the 7.x package unbundled.
import { OpenAILiveWebRTC } from "openai-live/lib/live/webrtc";
import { logWarn } from "@/logger";
import type {
  LiveChannelEvent,
  VoiceControlSocket,
  VoiceControlSocketHandlers,
  VoiceCreationRequest,
  VoiceHost,
  VoiceLiveConnection,
  VoiceLiveConnectOptions,
  VoiceMicrophone,
  VoicePlayback,
} from "@/agentMode/voice/types";

/**
 * Builds the runtime the controller talks to, bound to the window that owns
 * the Copilot view: capture, playback, and the control socket all come from
 * that window so a chat in a popout keeps working.
 *
 * The one exception is the peer connection. `OpenAILiveWebRTC` constructs it
 * from `globalThis.RTCPeerConnection`, so it belongs to the window the plugin
 * loaded in; Electron shares one media stack across a vault's windows, so a
 * popout's tracks still negotiate, but the constructor is not selectable.
 *
 * @param ownerWindow The view's own window, never the module-global `window`.
 */
export function createWindowVoiceHost(ownerWindow: Window): VoiceHost {
  return {
    timers: {
      setTimeout: (handler, ms) => ownerWindow.setTimeout(handler, ms),
      clearTimeout: (id) => ownerWindow.clearTimeout(id),
    },
    captureMicrophone: () => captureMicrophone(ownerWindow),
    createLiveConnection: () => createLiveConnection(),
    createPlayback: (onOutputLevel) => createPlayback(ownerWindow, onOutputLevel),
    createSession: (request) => createSession(request),
    deleteSession: (request) => deleteSession(request),
    openControlSocket: (url, handlers) => openControlSocket(ownerWindow, url, handlers),
  };
}

/** `Window` does not declare the constructors its realm owns. */
interface WindowWithSockets extends Window {
  WebSocket: typeof WebSocket;
}

async function captureMicrophone(ownerWindow: Window): Promise<VoiceMicrophone> {
  const stream = await ownerWindow.navigator.mediaDevices.getUserMedia({ audio: true });
  return {
    stream,
    setEnabled: (enabled: boolean) => {
      for (const track of stream.getAudioTracks()) track.enabled = enabled;
    },
    stop: () => {
      for (const track of stream.getTracks()) track.stop();
    },
  };
}

function createLiveConnection(): VoiceLiveConnection {
  const connection = new OpenAILiveWebRTC();
  return {
    addMicrophone: (stream: MediaStream) => {
      for (const track of stream.getAudioTracks())
        connection.peerConnection.addTrack(track, stream);
    },
    onRemoteStream: (handler: (stream: MediaStream) => void) => {
      connection.peerConnection.addEventListener("track", (event: RTCTrackEvent) => {
        const [stream] = event.streams;
        if (stream) handler(stream);
      });
    },
    onEvent: (handler: (event: LiveChannelEvent) => void) => {
      // Subscribing per type rather than to every event keeps the reflected
      // audio frames — the bulk of the channel, and the only speech on it —
      // out of the plugin entirely.
      connection.on("session.started", handler);
      connection.on("session.input_transcript.delta", handler);
      connection.on("session.output_transcript.delta", handler);
      connection.on("session.input_audio.muted", handler);
      connection.on("session.input_audio.unmuted", handler);
    },
    connect: (options: VoiceLiveConnectOptions) => connection.connect(options),
    close: () => connection.close(),
  };
}

function createPlayback(
  ownerWindow: Window,
  onOutputLevel?: (level: number) => void
): VoicePlayback {
  let element: HTMLAudioElement | null = null;
  let context: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let frame: number | null = null;
  const stopMeter = () => {
    if (frame !== null) ownerWindow.cancelAnimationFrame(frame);
    frame = null;
    source?.disconnect();
    analyser?.disconnect();
    if (context) void context.close().catch(() => undefined);
    context = null;
    source = null;
    analyser = null;
    onOutputLevel?.(0);
  };
  const stop = () => {
    stopMeter();
    if (!element) return;
    element.pause();
    element.srcObject = null;
    element.remove();
    element = null;
  };
  return {
    play: (stream: MediaStream) => {
      stop();
      // Playback and metering follow the view, including when it lives in a popout.
      element = ownerWindow.document.body.createEl("audio", {}, (el) => {
        el.autoplay = true;
      });
      element.srcObject = stream;
      void element.play().catch((error: unknown) => {
        logWarn("[Voice] remote audio could not start", {
          errorName: error instanceof Error ? error.name : "unknown",
        });
      });
      if (!onOutputLevel) return;
      try {
        const { AudioContext: OwnerAudioContext } = ownerWindow as Window & {
          AudioContext: typeof AudioContext;
        };
        context = new OwnerAudioContext();
        source = context.createMediaStreamSource(stream);
        analyser = context.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        // The audio element owns playback; this graph only measures received
        // samples. See designdocs/VOICE_CHAT_DEMO_DESIGN.md, "User experience".
        const samples = new Float32Array(analyser.fftSize);
        let lastSampleMs = -Infinity;
        const sample = (time: number) => {
          if (!analyser) return;
          if (time - lastSampleMs >= 50) {
            analyser.getFloatTimeDomainData(samples);
            let energy = 0;
            for (const value of samples) energy += value * value;
            onOutputLevel(
              Math.min(1, Math.round(Math.sqrt(energy / samples.length) * 1000) / 1000)
            );
            lastSampleMs = time;
          }
          frame = ownerWindow.requestAnimationFrame(sample);
        };
        frame = ownerWindow.requestAnimationFrame(sample);
        const meteredContext = context;
        void context.resume().catch(() => {
          if (context === meteredContext) stopMeter();
        });
      } catch {
        // A meter failure must not stop the call's audio. The waveform stays
        // flat, as required by designdocs/VOICE_CHAT_DEMO_DESIGN.md.
        stopMeter();
        logWarn("[Voice] remote audio metering is unavailable");
      }
    },
    stop,
  };
}

/**
 * Creates the live session through Obsidian's request path: this is an
 * ordinary non-streaming HTTPS call, so it does not need `fetch`.
 */
async function createSession(request: VoiceCreationRequest): Promise<unknown> {
  const response = await requestUrl({
    url: request.url,
    method: "POST",
    contentType: "application/json",
    headers: { Authorization: `Bearer ${request.credential}` },
    body: request.body,
    throw: false,
  });
  if (response.status >= 400) {
    throw new Error(`The voice server refused the session (HTTP ${response.status}).`);
  }
  return response.json;
}

/**
 * Asks the server to release a session. The endpoint is idempotent and always
 * succeeds, so a failure here means the request never arrived; the call is
 * reported as uncertain rather than retried.
 */
async function deleteSession(request: { url: string; credential: string }): Promise<void> {
  const response = await requestUrl({
    url: request.url,
    method: "DELETE",
    headers: { Authorization: `Bearer ${request.credential}` },
    throw: false,
  });
  if (response.status >= 400) {
    throw new Error(`The voice server refused to release the session (HTTP ${response.status}).`);
  }
}

function openControlSocket(
  ownerWindow: Window,
  url: string,
  handlers: VoiceControlSocketHandlers
): VoiceControlSocket {
  // The socket must come from the view's own window so a closing popout tears
  // it down with the view.
  const { WebSocket: OwnerWebSocket } = ownerWindow as WindowWithSockets;
  const socket = new OwnerWebSocket(url);
  socket.addEventListener("open", () => handlers.onOpen());
  socket.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (typeof event.data === "string") handlers.onMessage(event.data);
  });
  socket.addEventListener("close", () => handlers.onClose());
  socket.addEventListener("error", () => handlers.onError());
  return {
    send: (payload: string) => socket.send(payload),
    close: () => socket.close(),
  };
}

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
    createPlayback: () => createPlayback(ownerWindow),
    createSession: (request) => createSession(request),
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

function createPlayback(ownerWindow: Window): VoicePlayback {
  let element: HTMLAudioElement | null = null;
  return {
    play: (stream: MediaStream) => {
      // The element lives in the owning window's document because playback
      // follows the view, not whichever window happens to be focused.
      element = ownerWindow.document.body.createEl("audio", {}, (el) => {
        el.autoplay = true;
      });
      element.srcObject = stream;
      void element.play().catch((error: unknown) => {
        logWarn("[Voice] remote audio could not start", {
          errorName: error instanceof Error ? error.name : "unknown",
        });
      });
    },
    stop: () => {
      if (!element) return;
      element.pause();
      element.srcObject = null;
      element.remove();
      element = null;
    },
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

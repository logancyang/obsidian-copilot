import { logInfo } from "@/logger";
import { getSettings } from "@/settings/model";
import { frameSink, type FrameRecord } from "./frameSink";

const MAX_PAYLOAD_CHARS = 400;

interface JsonRpcFrame {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

/**
 * Wrap the subprocess stdin/stdout streams so every NDJSON-framed
 * JSON-RPC message is logged in both directions. Outbound is what
 * `ClientSideConnection` writes to stdin; inbound is what we read from
 * stdout. The taps are passthroughs — bytes flow through unchanged.
 *
 * Method names are remembered per request id so that responses (which
 * carry only id + result/error) can be labeled with the method they
 * answered.
 */
export function wrapStreamsForDebug(
  stdin: WritableStream<Uint8Array>,
  stdout: ReadableStream<Uint8Array>,
  tag: string
): { stdin: WritableStream<Uint8Array>; stdout: ReadableStream<Uint8Array> } {
  const outboundPending = new Map<string, string>();
  const inboundPending = new Map<string, string>();

  return {
    stdin: tapWritable(stdin, (line) => logFrame("→", line, tag, outboundPending, inboundPending)),
    stdout: tapReadable(stdout, (line) =>
      logFrame("←", line, tag, inboundPending, outboundPending)
    ),
  };
}

function tapWritable(
  inner: WritableStream<Uint8Array>,
  onLine: (line: string) => void
): WritableStream<Uint8Array> {
  // Avoid `TransformStream` / `pipeTo` because the inner stream comes from
  // Node's `Writable.toWeb()` and is branded against `node:internal/
  // webstreams`; mixing it with global-realm streams throws
  // `ERR_INVALID_ARG_TYPE`. A hand-rolled WritableStream that delegates to
  // the inner writer side-steps the realm check entirely.
  const writer = inner.getWriter();
  const splitter = new NdjsonLineSplitter(onLine);
  return new WritableStream<Uint8Array>({
    async write(chunk) {
      splitter.push(chunk);
      await writer.write(chunk);
    },
    async close() {
      splitter.flush();
      await writer.close();
    },
    async abort(reason) {
      splitter.flush();
      await writer.abort(reason);
    },
  });
}

function tapReadable(
  inner: ReadableStream<Uint8Array>,
  onLine: (line: string) => void
): ReadableStream<Uint8Array> {
  // `tee()` is a same-realm method (no class mismatch), so we get two
  // branded-equivalent ReadableStreams: one for the SDK to consume, one we
  // drain ourselves for logging.
  const [forConsumer, forLogging] = inner.tee();
  const splitter = new NdjsonLineSplitter(onLine);
  void (async () => {
    const reader = forLogging.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) splitter.push(value);
      }
      splitter.flush();
    } catch {
      // Stream closed/aborted; nothing for the tap to do.
    }
  })();
  return forConsumer;
}

class NdjsonLineSplitter {
  private buffer = "";
  private decoder = new TextDecoder();

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: Uint8Array): void {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line) this.emit(line);
    }
  }

  flush(): void {
    const tail = this.buffer.trim();
    this.buffer = "";
    if (tail) this.emit(tail);
  }

  private emit(line: string): void {
    try {
      this.onLine(line);
    } catch {
      // Logging must never break the protocol stream.
    }
  }
}

function logFrame(
  arrow: "→" | "←",
  line: string,
  tag: string,
  /** Pending requests originated by *our* side of this stream. */
  ownPending: Map<string, string>,
  /** Pending requests originated by the *other* side of this stream. */
  peerPending: Map<string, string>
): void {
  // Read once per frame so the hot path doesn't allocate a record + timestamp
  // when the toggle is off.
  const fullFramesOn = !!getSettings().agentMode?.debugFullFrames;
  const emit = fullFramesOn
    ? (kind: FrameRecord["kind"], method: string, id: string | null, payload: unknown) =>
        frameSink.append({
          ts: new Date().toISOString(),
          dir: arrow,
          tag,
          kind,
          method,
          id,
          payload,
        })
    : null;

  let frame: JsonRpcFrame;
  try {
    frame = JSON.parse(line);
  } catch {
    logInfo(`[ACP ${arrow}][${tag}] (unparsed) ${truncate(line)}`);
    emit?.("raw", "(unparsed)", null, { raw: line });
    return;
  }

  const idStr = frame.id !== undefined ? String(frame.id) : null;

  if (frame.method) {
    // Request or notification.
    const method = frame.method;
    const idLabel = idStr !== null ? `#${idStr}` : "(notif)";
    if (idStr !== null) ownPending.set(idStr, method);
    logInfo(`[ACP ${arrow}][${tag}] ${method}  ${idLabel}  ${formatPayload(frame.params)}`);
    emit?.(idStr !== null ? "request" : "notif", method, idStr, frame.params);
    return;
  }

  // Response (result or error). Method name comes from the side that
  // originated the request — that's `peerPending` from this stream's
  // perspective.
  const method = idStr !== null ? (peerPending.get(idStr) ?? "(unknown)") : "(unknown)";
  if (idStr !== null) peerPending.delete(idStr);
  const idLabel = idStr !== null ? `#${idStr}` : "(no-id)";
  if (frame.error) {
    logInfo(`[ACP ${arrow}][${tag}] (error) ${method}  ${idLabel}  ${formatPayload(frame.error)}`);
    emit?.("error", method, idStr, frame.error);
  } else {
    logInfo(`[ACP ${arrow}][${tag}] ${method}  ${idLabel}  ${formatPayload(frame.result)}`);
    emit?.("result", method, idStr, frame.result);
  }
}

function formatPayload(value: unknown): string {
  if (value === undefined) return "";
  let s: string;
  try {
    s = JSON.stringify(value);
  } catch {
    s = String(value);
  }
  return truncate(s);
}

function truncate(s: string): string {
  if (s.length <= MAX_PAYLOAD_CHARS) return s;
  return s.slice(0, MAX_PAYLOAD_CHARS) + `…(+${s.length - MAX_PAYLOAD_CHARS})`;
}

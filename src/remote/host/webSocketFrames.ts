export const OPCODE = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa,
} as const;

export type IncomingMessage =
  | { type: "text"; text: string }
  | { type: "ping"; payload: Uint8Array }
  | { type: "pong" }
  | { type: "close"; code: number };

export class FrameProtocolError extends Error {
  constructor(
    readonly closeCode: number,
    message: string
  ) {
    super(message);
  }
}

const MAX_CONTROL_PAYLOAD = 125;
const MAX_HEADER_BYTES = 10;
// A message is a few frames at most. Counting fragments bounds the memory an empty or one-byte
// fragment costs, which the byte limit alone does not. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
const MAX_FRAGMENTS = 1024;

/**
 * Whether a status code may appear in a close frame on the wire (RFC 6455 section 7.4).
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/610
 */
export function isValidCloseCode(code: number): boolean {
  return (
    (code >= 1000 && code <= 1003) ||
    (code >= 1007 && code <= 1014) ||
    (code >= 3000 && code <= 4999)
  );
}

function concat(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

/**
 * Decodes the client-to-server half of an RFC 6455 connection: masked text frames, ping, pong and
 * close, with every size bounded by `limit`. It throws `FrameProtocolError` for anything else and
 * never buffers more than one frame beyond the limit.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/610
 */
export class FrameDecoder {
  private chunks: Uint8Array[] = [];
  private buffered = 0;
  private fragments: Uint8Array[] = [];
  private fragmentBytes = 0;
  private assemblingText = false;
  private closed = false;

  /**
   * @param limit - The largest frame or message, in payload bytes. It may be raised while the
   * decoder is running, and the new value applies from the next frame.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/610
   */
  constructor(public limit: number) {}

  /**
   * Feeds received bytes and reports each complete message to `onMessage` as it is decoded, so the
   * callback can change `limit` before the frames that follow in the same chunk are read. Nothing is
   * reported after a close frame. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
   *
   * @param chunk - Bytes from the socket, in any split.
   * @param onMessage - Called synchronously for every complete message, in order.
   */
  push(chunk: Uint8Array, onMessage: (message: IncomingMessage) => void): void {
    if (this.closed) return;
    this.chunks.push(chunk);
    this.buffered += chunk.length;
    while (!this.closed) {
      const message = this.readFrame();
      if (message === undefined) return;
      if (message === null) continue;
      if (message.type === "close") this.closed = true;
      onMessage(message);
    }
  }

  private readFrame(): IncomingMessage | null | undefined {
    const head = this.peek(MAX_HEADER_BYTES);
    if (head.length < 2) return undefined;
    const first = head[0];
    const second = head[1];
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    if ((first & 0x70) !== 0) throw new FrameProtocolError(1002, "reserved bits set");
    if ((second & 0x80) === 0) throw new FrameProtocolError(1002, "unmasked client frame");

    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (head.length < 4) return undefined;
      length = (head[2] << 8) | head[3];
      offset = 4;
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/610
      if (length < 126) throw new FrameProtocolError(1002, "non-minimal length");
    } else if (length === 127) {
      if (head.length < 10) return undefined;
      const view = new DataView(head.buffer, head.byteOffset, head.length);
      if (view.getUint32(2) !== 0) throw new FrameProtocolError(1009, "frame too large");
      length = view.getUint32(6);
      offset = 10;
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/610
      if (length < 65536) throw new FrameProtocolError(1002, "non-minimal length");
    }
    const isControl = opcode >= 0x8;
    if (isControl && (!fin || length > MAX_CONTROL_PAYLOAD)) {
      throw new FrameProtocolError(1002, "invalid control frame");
    }
    // A continuation counts against the message it extends, so the total is refused before its
    // payload is buffered. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
    const messageBytes = isControl ? length : this.fragmentBytes + length;
    if (messageBytes > this.limit) throw new FrameProtocolError(1009, "frame too large");
    if (this.buffered < offset + 4 + length) return undefined;

    const bytes = this.take(offset + 4 + length);
    const mask = bytes.subarray(offset, offset + 4);
    const payload = new Uint8Array(length);
    for (let index = 0; index < length; index++) {
      payload[index] = bytes[offset + 4 + index] ^ mask[index % 4];
    }
    return isControl ? this.readControl(opcode, payload) : this.readData(opcode, fin, payload);
  }

  private peek(count: number): Uint8Array {
    const out = new Uint8Array(Math.min(count, this.buffered));
    let filled = 0;
    for (const chunk of this.chunks) {
      if (filled === out.length) break;
      const part = chunk.subarray(0, out.length - filled);
      out.set(part, filled);
      filled += part.length;
    }
    return out;
  }

  private take(count: number): Uint8Array {
    const out = new Uint8Array(count);
    let filled = 0;
    while (filled < count) {
      const chunk = this.chunks[0];
      const part = chunk.subarray(0, count - filled);
      out.set(part, filled);
      filled += part.length;
      if (part.length === chunk.length) this.chunks.shift();
      else this.chunks[0] = chunk.subarray(part.length);
    }
    this.buffered -= count;
    return out;
  }

  private readControl(opcode: number, payload: Uint8Array): IncomingMessage | null {
    if (opcode === OPCODE.ping) return { type: "ping", payload };
    if (opcode === OPCODE.pong) return { type: "pong" };
    if (opcode === OPCODE.close) return this.readClose(payload);
    throw new FrameProtocolError(1002, "unknown control opcode");
  }

  // A close frame is empty or a status code followed by a UTF-8 reason. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
  private readClose(payload: Uint8Array): IncomingMessage {
    if (payload.length === 0) return { type: "close", code: 1005 };
    if (payload.length === 1) throw new FrameProtocolError(1002, "invalid close payload");
    const code = (payload[0] << 8) | payload[1];
    if (!isValidCloseCode(code)) throw new FrameProtocolError(1002, "invalid close status");
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(payload.subarray(2));
    } catch {
      throw new FrameProtocolError(1007, "invalid UTF-8 in close reason");
    }
    return { type: "close", code };
  }

  private readData(opcode: number, fin: boolean, payload: Uint8Array): IncomingMessage | null {
    if (opcode === OPCODE.binary) throw new FrameProtocolError(1003, "binary frames unsupported");
    if (opcode === OPCODE.text) {
      if (this.assemblingText)
        throw new FrameProtocolError(1002, "text inside a fragmented message");
      this.assemblingText = true;
    } else if (opcode === OPCODE.continuation) {
      if (!this.assemblingText) throw new FrameProtocolError(1002, "unexpected continuation");
    } else {
      throw new FrameProtocolError(1002, "unknown data opcode");
    }
    if (this.fragments.length >= MAX_FRAGMENTS) {
      throw new FrameProtocolError(1009, "too many fragments");
    }
    this.fragmentBytes += payload.length;
    this.fragments.push(payload);
    if (!fin) return null;

    const joined = concat(this.fragments, this.fragmentBytes);
    this.fragments = [];
    this.fragmentBytes = 0;
    this.assemblingText = false;
    try {
      return { type: "text", text: new TextDecoder("utf-8", { fatal: true }).decode(joined) };
    } catch {
      throw new FrameProtocolError(1007, "invalid UTF-8");
    }
  }
}

function frame(opcode: number, payload: Uint8Array): Uint8Array {
  const length = payload.length;
  const headerLength = length < 126 ? 2 : length < 65536 ? 4 : 10;
  const out = new Uint8Array(headerLength + length);
  out[0] = 0x80 | opcode;
  if (length < 126) {
    out[1] = length;
  } else if (length < 65536) {
    out[1] = 126;
    out[2] = length >> 8;
    out[3] = length & 0xff;
  } else {
    out[1] = 127;
    new DataView(out.buffer).setUint32(6, length);
  }
  out.set(payload, headerLength);
  return out;
}

export function encodeText(text: string): Uint8Array {
  return frame(OPCODE.text, new TextEncoder().encode(text));
}

export function encodePong(payload: Uint8Array): Uint8Array {
  return frame(OPCODE.pong, payload);
}

export function encodeClose(code: number): Uint8Array {
  return frame(OPCODE.close, new Uint8Array([code >> 8, code & 0xff]));
}

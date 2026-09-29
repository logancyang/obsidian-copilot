import {
  encodeClose,
  encodePong,
  encodeText,
  FrameDecoder,
  FrameProtocolError,
  isValidCloseCode,
  type IncomingMessage,
  OPCODE,
} from "@/remote/host/webSocketFrames";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/610";
const MASK = [0x12, 0x34, 0x56, 0x78];

function clientFrame(
  opcode: number,
  payload: Uint8Array,
  { fin = true, masked = true, rsv = 0 }: { fin?: boolean; masked?: boolean; rsv?: number } = {}
): Uint8Array {
  const length = payload.length;
  const header: number[] = [(fin ? 0x80 : 0) | rsv | opcode];
  const maskBit = masked ? 0x80 : 0;
  if (length < 126) header.push(maskBit | length);
  else if (length < 65536) header.push(maskBit | 126, length >> 8, length & 0xff);
  else
    header.push(
      maskBit | 127,
      0,
      0,
      0,
      0,
      (length >>> 24) & 0xff,
      (length >> 16) & 0xff,
      (length >> 8) & 0xff,
      length & 0xff
    );
  const body = masked ? payload.map((byte, index) => byte ^ MASK[index % 4]) : payload;
  return new Uint8Array([...header, ...(masked ? MASK : []), ...body]);
}

/** A masked text frame whose length field uses the form the caller names, even when a shorter one fits. https://github.com/Brevilabs/obsidian-copilot-private/issues/610 */
function paddedLengthFrame(form: 16 | 64, payload: Uint8Array): Uint8Array {
  const length = payload.length;
  const header =
    form === 16
      ? [0x81, 0x80 | 126, length >> 8, length & 0xff]
      : [0x81, 0x80 | 127, 0, 0, 0, 0, 0, 0, length >> 8, length & 0xff];
  const body = payload.map((byte, index) => byte ^ MASK[index % 4]);
  return new Uint8Array([...header, ...MASK, ...body]);
}

const text = (value: string) => new TextEncoder().encode(value);

function decode(decoder: FrameDecoder, ...chunks: Uint8Array[]): IncomingMessage[] {
  const messages: IncomingMessage[] = [];
  for (const chunk of chunks) decoder.push(chunk, (message) => messages.push(message));
  return messages;
}

function errorOf(action: () => unknown): FrameProtocolError {
  try {
    action();
  } catch (error) {
    return error as FrameProtocolError;
  }
  throw new Error("expected a FrameProtocolError");
}

describe("webSocketFrames", () => {
  describe("FrameDecoder", () => {
    describe("push()", () => {
      it("decodes a masked text frame into its text", () => {
        const decoder = new FrameDecoder(1024);

        expect(decode(decoder, clientFrame(OPCODE.text, text("héllo")))).toEqual([
          { type: "text", text: "héllo" },
        ]);
      });

      it("decodes several frames delivered in one chunk, in order", () => {
        const decoder = new FrameDecoder(1024);
        const chunk = new Uint8Array([
          ...clientFrame(OPCODE.text, text("one")),
          ...clientFrame(OPCODE.text, text("two")),
        ]);

        expect(decode(decoder, chunk)).toEqual([
          { type: "text", text: "one" },
          { type: "text", text: "two" },
        ]);
      });

      it("waits for the rest of a frame that arrives split across chunks, even one byte at a time", () => {
        const decoder = new FrameDecoder(1024);
        const bytes = clientFrame(OPCODE.text, text("split across chunks"));
        const messages = decode(decoder, ...[...bytes].map((byte) => new Uint8Array([byte])));

        expect(messages).toEqual([{ type: "text", text: "split across chunks" }]);
      });

      it("decodes a payload that needs the 16-bit length", () => {
        const decoder = new FrameDecoder(1_000_000);
        const long = "a".repeat(300);

        expect(decode(decoder, clientFrame(OPCODE.text, text(long)))).toEqual([
          { type: "text", text: long },
        ]);
      });

      it("decodes a payload that needs the 64-bit length", () => {
        const decoder = new FrameDecoder(1_000_000);
        const long = "b".repeat(70_000);

        expect(decode(decoder, clientFrame(OPCODE.text, text(long)))).toEqual([
          { type: "text", text: long },
        ]);
      });

      it("reassembles a fragmented text message and delivers a ping that arrives between fragments", () => {
        const decoder = new FrameDecoder(1024);

        const messages = decode(
          decoder,
          clientFrame(OPCODE.text, text("Hel"), { fin: false }),
          clientFrame(OPCODE.ping, text("p")),
          clientFrame(OPCODE.continuation, text("lo"))
        );

        expect(
          messages.map((message) => (message.type === "ping" ? [...message.payload] : message))
        ).toEqual([[...text("p")], { type: "text", text: "Hello" }]);
      });

      it("reports a close frame with its status code", () => {
        const decoder = new FrameDecoder(1024);

        expect(decode(decoder, clientFrame(OPCODE.close, new Uint8Array([0x03, 0xe8])))).toEqual([
          { type: "close", code: 1000 },
        ]);
      });

      it("accepts a close frame whose reason is valid UTF-8", () => {
        const decoder = new FrameDecoder(1024);

        expect(
          decode(decoder, clientFrame(OPCODE.close, new Uint8Array([0x03, 0xe8, ...text("bye")])))
        ).toEqual([{ type: "close", code: 1000 }]);
      });

      it("reports a close frame without a payload as status 1005", () => {
        const decoder = new FrameDecoder(1024);

        expect(decode(decoder, clientFrame(OPCODE.close, new Uint8Array()))).toEqual([
          { type: "close", code: 1005 },
        ]);
      });

      it("reports a pong", () => {
        const decoder = new FrameDecoder(1024);

        expect(decode(decoder, clientFrame(OPCODE.pong, new Uint8Array()))).toEqual([
          { type: "pong" },
        ]);
      });

      it(`delivers nothing that follows a close frame, in the same chunk or a later one (${ISSUE})`, () => {
        const decoder = new FrameDecoder(1024);
        const chunk = new Uint8Array([
          ...clientFrame(OPCODE.close, new Uint8Array([0x03, 0xe8])),
          ...clientFrame(OPCODE.text, text("after close")),
        ]);

        expect(decode(decoder, chunk, clientFrame(OPCODE.text, text("later")))).toEqual([
          { type: "close", code: 1000 },
        ]);
      });

      const REJECTED_FRAMES: Array<[string, Uint8Array, number]> = [
        ["an unmasked client frame", clientFrame(OPCODE.text, text("x"), { masked: false }), 1002],
        [
          "a frame with reserved bits set",
          clientFrame(OPCODE.text, text("x"), { rsv: 0x40 }),
          1002,
        ],
        ["a binary frame", clientFrame(OPCODE.binary, text("x")), 1003],
        ["an unknown data opcode", clientFrame(0x3, text("x")), 1002],
        ["an unknown control opcode", clientFrame(0xb, text("x")), 1002],
        ["a fragmented control frame", clientFrame(OPCODE.ping, text("x"), { fin: false }), 1002],
        ["an oversized control frame", clientFrame(OPCODE.ping, new Uint8Array(126)), 1002],
        [
          "a continuation with nothing to continue",
          clientFrame(OPCODE.continuation, text("x")),
          1002,
        ],
        ["invalid UTF-8", clientFrame(OPCODE.text, new Uint8Array([0xff, 0xfe])), 1007],
        ["a one-byte close payload", clientFrame(OPCODE.close, new Uint8Array([1])), 1002],
        [
          "a close reason that is not UTF-8",
          clientFrame(OPCODE.close, new Uint8Array([0x03, 0xe8, 0xff])),
          1007,
        ],
        [
          "a close status that must not appear on the wire (1005)",
          clientFrame(OPCODE.close, new Uint8Array([0x03, 0xed])),
          1002,
        ],
        [
          "a close status below 1000",
          clientFrame(OPCODE.close, new Uint8Array([0x03, 0xe7])),
          1002,
        ],
        [
          "a close status above 4999",
          clientFrame(OPCODE.close, new Uint8Array([0x13, 0x88])),
          1002,
        ],
        [
          `a 16-bit length for a payload that fits in 7 bits (${ISSUE})`,
          paddedLengthFrame(16, text("short")),
          1002,
        ],
        [
          `a 64-bit length for a payload that fits in 16 bits (${ISSUE})`,
          paddedLengthFrame(64, text("short")),
          1002,
        ],
      ];

      it.each(
        REJECTED_FRAMES.map(([label, bytes, closeCode]) => [label, closeCode, bytes] as const)
      )("rejects %s with close code %i", (_label, closeCode, bytes) => {
        expect(errorOf(() => decode(new FrameDecoder(1024), bytes)).closeCode).toBe(closeCode);
      });

      it("rejects a new text frame that starts inside an unfinished fragmented message", () => {
        const decoder = new FrameDecoder(1024);
        decode(decoder, clientFrame(OPCODE.text, text("a"), { fin: false }));

        expect(errorOf(() => decode(decoder, clientFrame(OPCODE.text, text("b")))).closeCode).toBe(
          1002
        );
      });

      it(`rejects a frame larger than the limit before its payload arrives (${ISSUE})`, () => {
        const decoder = new FrameDecoder(100);
        const header = clientFrame(OPCODE.text, new Uint8Array(200)).subarray(0, 8);

        expect(errorOf(() => decode(decoder, header)).closeCode).toBe(1009);
      });

      it("rejects a fragmented message whose fragments together exceed the limit", () => {
        const decoder = new FrameDecoder(100);
        decode(decoder, clientFrame(OPCODE.text, new Uint8Array(60).fill(97), { fin: false }));

        expect(
          errorOf(() =>
            decode(decoder, clientFrame(OPCODE.continuation, new Uint8Array(60).fill(97)))
          ).closeCode
        ).toBe(1009);
      });

      it(`rejects a continuation that would push the message past the limit before its payload arrives (${ISSUE})`, () => {
        const decoder = new FrameDecoder(100);
        decode(decoder, clientFrame(OPCODE.text, new Uint8Array(60).fill(97), { fin: false }));
        const header = clientFrame(OPCODE.continuation, new Uint8Array(60)).subarray(0, 6);

        expect(errorOf(() => decode(decoder, header)).closeCode).toBe(1009);
      });

      it(`rejects a message split into more than 1024 fragments, even when every fragment is empty (${ISSUE})`, () => {
        const decoder = new FrameDecoder(1024);
        const fragment = clientFrame(OPCODE.continuation, new Uint8Array(), { fin: false });
        decode(decoder, clientFrame(OPCODE.text, new Uint8Array(), { fin: false }));

        const error = errorOf(() => {
          for (let count = 0; count < 1100; count++) decode(decoder, fragment);
        });

        expect(error.closeCode).toBe(1009);
      });

      it("rejects a 64-bit length whose high word is set", () => {
        const decoder = new FrameDecoder(100);
        const bytes = new Uint8Array([0x81, 0xff, 0, 0, 0, 1, 0, 0, 0, 0, ...MASK]);

        expect(errorOf(() => decode(decoder, bytes)).closeCode).toBe(1009);
      });

      it("rejects a 64-bit length above 2^53 without reading a payload", () => {
        const decoder = new FrameDecoder(1_000_000);
        const bytes = new Uint8Array([0x81, 0xff, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

        expect(errorOf(() => decode(decoder, bytes)).closeCode).toBe(1009);
      });

      it("accepts a larger frame once the limit is raised", () => {
        const decoder = new FrameDecoder(10);
        decoder.limit = 1000;

        expect(decode(decoder, clientFrame(OPCODE.text, text("x".repeat(500))))).toHaveLength(1);
      });

      it(`applies a limit raised while handling one message to the frames that follow in the same chunk (${ISSUE})`, () => {
        const decoder = new FrameDecoder(100);
        const chunk = new Uint8Array([
          ...clientFrame(OPCODE.text, text("auth")),
          ...clientFrame(OPCODE.text, text("y".repeat(500))),
        ]);
        const texts: string[] = [];

        decoder.push(chunk, (message) => {
          if (message.type === "text") texts.push(message.text);
          decoder.limit = 1000;
        });

        expect(texts.map((value) => value.length)).toEqual([4, 500]);
      });
    });
  });

  describe("isValidCloseCode()", () => {
    it.each([
      1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014, 3000, 4401, 4999,
    ])("accepts %i", (code) => {
      expect(isValidCloseCode(code)).toBe(true);
    });

    it.each([0, 999, 1004, 1005, 1006, 1015, 1016, 2999, 5000])(
      "rejects %i, which an endpoint must not send",
      (code) => {
        expect(isValidCloseCode(code)).toBe(false);
      }
    );
  });

  describe("encodeText()", () => {
    it("produces an unmasked final text frame with a 7-bit length", () => {
      expect([...encodeText("hi")]).toEqual([0x81, 2, 104, 105]);
    });

    it("uses the 16-bit length form from 126 bytes", () => {
      const frame = encodeText("a".repeat(126));

      expect([...frame.subarray(0, 4)]).toEqual([0x81, 126, 0, 126]);
      expect(frame).toHaveLength(4 + 126);
    });

    it("uses the 64-bit length form from 65536 bytes", () => {
      const frame = encodeText("a".repeat(65_536));

      expect([...frame.subarray(0, 10)]).toEqual([0x81, 127, 0, 0, 0, 0, 0, 1, 0, 0]);
    });

    it("encodes multi-byte text by its UTF-8 byte length", () => {
      expect(encodeText("é")[1]).toBe(2);
    });
  });

  describe("encodeClose()", () => {
    it("produces a close frame carrying the status code", () => {
      expect([...encodeClose(4403)]).toEqual([0x88, 2, 0x11, 0x33]);
    });
  });

  describe("encodePong()", () => {
    it("echoes the ping payload in an unmasked pong frame", () => {
      expect([...encodePong(new Uint8Array([1, 2]))]).toEqual([0x8a, 2, 1, 2]);
    });
  });
});

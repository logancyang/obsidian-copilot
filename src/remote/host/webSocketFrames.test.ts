import {
  encodeClose,
  encodePong,
  encodeText,
  FrameDecoder,
  FrameProtocolError,
  OPCODE,
} from "@/remote/host/webSocketFrames";

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

const text = (value: string) => new TextEncoder().encode(value);

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

        expect(decoder.push(clientFrame(OPCODE.text, text("héllo")))).toEqual([
          { type: "text", text: "héllo" },
        ]);
      });

      it("decodes several frames delivered in one chunk, in order", () => {
        const decoder = new FrameDecoder(1024);
        const chunk = new Uint8Array([
          ...clientFrame(OPCODE.text, text("one")),
          ...clientFrame(OPCODE.text, text("two")),
        ]);

        expect(decoder.push(chunk)).toEqual([
          { type: "text", text: "one" },
          { type: "text", text: "two" },
        ]);
      });

      it("waits for the rest of a frame that arrives split across chunks, even one byte at a time", () => {
        const decoder = new FrameDecoder(1024);
        const bytes = clientFrame(OPCODE.text, text("split across chunks"));
        const messages = [...bytes].flatMap((byte) => decoder.push(new Uint8Array([byte])));

        expect(messages).toEqual([{ type: "text", text: "split across chunks" }]);
      });

      it("decodes a payload that needs the 16-bit length", () => {
        const decoder = new FrameDecoder(1_000_000);
        const long = "a".repeat(300);

        expect(decoder.push(clientFrame(OPCODE.text, text(long)))).toEqual([
          { type: "text", text: long },
        ]);
      });

      it("decodes a payload that needs the 64-bit length", () => {
        const decoder = new FrameDecoder(1_000_000);
        const long = "b".repeat(70_000);

        expect(decoder.push(clientFrame(OPCODE.text, text(long)))).toEqual([
          { type: "text", text: long },
        ]);
      });

      it("reassembles a fragmented text message and delivers a ping that arrives between fragments", () => {
        const decoder = new FrameDecoder(1024);

        const messages = [
          ...decoder.push(clientFrame(OPCODE.text, text("Hel"), { fin: false })),
          ...decoder.push(clientFrame(OPCODE.ping, text("p"))),
          ...decoder.push(clientFrame(OPCODE.continuation, text("lo"))),
        ];

        expect(
          messages.map((message) => (message.type === "ping" ? [...message.payload] : message))
        ).toEqual([[...text("p")], { type: "text", text: "Hello" }]);
      });

      it("reports a close frame with its status code", () => {
        const decoder = new FrameDecoder(1024);

        expect(decoder.push(clientFrame(OPCODE.close, new Uint8Array([0x03, 0xe8])))).toEqual([
          { type: "close", code: 1000 },
        ]);
      });

      it("reports a close frame without a payload as status 1005", () => {
        const decoder = new FrameDecoder(1024);

        expect(decoder.push(clientFrame(OPCODE.close, new Uint8Array()))).toEqual([
          { type: "close", code: 1005 },
        ]);
      });

      it("reports a pong", () => {
        const decoder = new FrameDecoder(1024);

        expect(decoder.push(clientFrame(OPCODE.pong, new Uint8Array()))).toEqual([
          { type: "pong" },
        ]);
      });

      it.each([
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
      ])("rejects %s with close code %i", (_label, bytes, closeCode) => {
        expect(errorOf(() => new FrameDecoder(1024).push(bytes)).closeCode).toBe(closeCode);
      });

      it("rejects a new text frame that starts inside an unfinished fragmented message", () => {
        const decoder = new FrameDecoder(1024);
        decoder.push(clientFrame(OPCODE.text, text("a"), { fin: false }));

        expect(errorOf(() => decoder.push(clientFrame(OPCODE.text, text("b")))).closeCode).toBe(
          1002
        );
      });

      it("rejects a frame larger than the limit before its payload arrives (https://github.com/Brevilabs/obsidian-copilot-private/issues/610)", () => {
        const decoder = new FrameDecoder(100);
        const header = clientFrame(OPCODE.text, new Uint8Array(200)).subarray(0, 8);

        expect(errorOf(() => decoder.push(header)).closeCode).toBe(1009);
      });

      it("rejects a fragmented message whose fragments together exceed the limit", () => {
        const decoder = new FrameDecoder(100);
        decoder.push(clientFrame(OPCODE.text, new Uint8Array(60).fill(97), { fin: false }));

        expect(
          errorOf(() => decoder.push(clientFrame(OPCODE.continuation, new Uint8Array(60).fill(97))))
            .closeCode
        ).toBe(1009);
      });

      it("rejects a 64-bit length whose high word is set", () => {
        const decoder = new FrameDecoder(100);
        const bytes = new Uint8Array([0x81, 0xff, 0, 0, 0, 1, 0, 0, 0, 0, ...MASK]);

        expect(errorOf(() => decoder.push(bytes)).closeCode).toBe(1009);
      });

      it("accepts a larger frame once the limit is raised", () => {
        const decoder = new FrameDecoder(10);
        decoder.limit = 1000;

        expect(decoder.push(clientFrame(OPCODE.text, text("x".repeat(500))))).toHaveLength(1);
      });
    });
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

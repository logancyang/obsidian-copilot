import {
  TRUNCATION_NOTE_RESERVE_BYTES,
  byteLength,
  decodeTail,
  encodeText,
  headOfText,
  readTailFrom,
  tailOfText,
  withTruncationNote,
  type TailReadable,
} from "@/utils/logTail";

const encode = (text: string) => new TextEncoder().encode(text);

/**
 * File handle standing in for an open log. `chunkSize` forces the short reads a
 * real `FileHandle` is free to return, and a `size` above the content's length
 * stands in for a file that shrank after it was measured.
 */
function fakeHandle(content: Uint8Array, chunkSize = content.length, size = content.length) {
  const handle: TailReadable = {
    stat: async () => ({ size }),
    read: async (buffer, offset, length, position) => {
      const available = Math.max(0, content.length - position);
      const bytesRead = Math.min(chunkSize, length, available);
      buffer.set(content.subarray(position, position + bytesRead), offset);
      return { bytesRead };
    },
  };
  return handle;
}

describe("logTail", () => {
  describe("tailOfText()", () => {
    it("returns the whole text with its byte length when it fits the budget", () => {
      expect(tailOfText("héllo", 10)).toEqual({ text: "héllo", totalBytes: 6 });
    });

    it("keeps the newest bytes of an oversized text and reports its full size", () => {
      expect(tailOfText("old\nnew\n", 4)).toEqual({ text: "new\n", totalBytes: 8 });
    });

    it("drops a character cut in half at the front so the tail never starts with a replacement glyph", () => {
      // 3 bytes per character: a 4-byte tail starts one byte into the middle one.
      expect(tailOfText("行行行", 4)).toEqual({ text: "行", totalBytes: 9 });
    });
  });

  describe("decodeTail()", () => {
    it.each([
      ["a clean character boundary", encode("😀"), "😀"],
      ["a cut through a character", encode("😀😀").subarray(2), "😀"],
    ])("decodes bytes that start at %s without a replacement glyph", (_case, bytes, text) => {
      expect(decodeTail(bytes)).toBe(text);
    });
  });

  describe("headOfText()", () => {
    it("returns the whole text with its byte length when it fits the budget", () => {
      expect(headOfText("héllo", 6)).toEqual({ text: "héllo", totalBytes: 6 });
    });

    it("cuts an oversized text on a character boundary and reports its full size", () => {
      // 3 bytes per character: a 4-byte cap lands one byte into the second one.
      expect(headOfText("行行行", 4)).toEqual({ text: "行", totalBytes: 9 });
    });
  });

  describe("withTruncationNote()", () => {
    it("prepends a banner naming the original size of the log the kept entries come from", () => {
      expect(withTruncationNote("kept\n", 40 * 1024 * 1024)).toBe(
        "… earlier entries omitted: only the newest entries of the original 40.0 MB log " +
          "are included …\nkept\n"
      );
    });

    it("never names the kept size, which redaction's rewrites can carry past the original", () => {
      expect(withTruncationNote("kept\n", 2)).not.toContain("5 B");
    });

    it("stays inside the reserve a tail gives back for it, at the widest size the formatter prints", () => {
      const banner = withTruncationNote("", Number.MAX_SAFE_INTEGER);

      expect(byteLength(banner)).toBeLessThan(TRUNCATION_NOTE_RESERVE_BYTES);
    });
  });

  describe("encodeText()", () => {
    it("encodes text as UTF-8 bytes", () => {
      expect(Array.from(encodeText("é"))).toEqual([0xc3, 0xa9]);
    });
  });

  describe("byteLength()", () => {
    it("measures text in UTF-8 bytes rather than characters", () => {
      expect(byteLength("行行")).toBe(6);
    });
  });

  describe("readTailFrom()", () => {
    it("keeps reading until the requested tail is filled rather than trusting one read", async () => {
      const content = encode("hello world");

      await expect(readTailFrom(fakeHandle(content, 3), 5)).resolves.toEqual({
        text: "world",
        totalBytes: content.length,
      });
    });

    it("decodes only what was actually read when the file shrank after being sized", async () => {
      const content = encode("abcdefghij");
      const result = await readTailFrom(fakeHandle(content, content.length, 20), 20);

      // The unfilled remainder of the buffer is NUL, which must not be bundled
      // as if the log contained it.
      expect(result.text).toBe("abcdefghij");
      expect(result.text).not.toContain("\u0000");
      expect(result.totalBytes).toBe(20);
    });

    it.each([
      ["a file with nothing in it", fakeHandle(new Uint8Array()), 1024],
      // Sized at 100 with a 50-byte cap, so the read starts at byte 50; the file
      // has since rotated down to 8 bytes, leaving that start past its new EOF.
      [
        "a file truncated past the start it planned to read from",
        fakeHandle(encode("survivor"), 8, 100),
        50,
      ],
    ])("returns an empty tail of zero total bytes for %s", async (_case, handle, maxBytes) => {
      await expect(readTailFrom(handle, maxBytes)).resolves.toEqual({ text: "", totalBytes: 0 });
    });

    it("skips a half character at the cut so the tail never starts with a replacement glyph", async () => {
      // 6 bytes back lands two bytes into the middle emoji.
      const result = await readTailFrom(fakeHandle(encode("😀😀😀")), 6);

      expect(result.text).toBe("😀");
    });
  });
});

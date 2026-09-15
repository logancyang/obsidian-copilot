import {
  TRUNCATION_NOTE_RESERVE_BYTES,
  byteLength,
  decodeTail,
  encodeText,
  headOfText,
  readLogFrom,
  tailOfText,
  withTruncationNote,
  type LogReadable,
} from "@/utils/logTail";

const encode = (text: string) => new TextEncoder().encode(text);

/**
 * File handle standing in for an open log. `chunkSize` forces the short reads a
 * real `FileHandle` is free to return, and a `size` above the content's length
 * stands in for a file that shrank after it was measured.
 */
function fakeHandle(content: Uint8Array, chunkSize = content.length, size = content.length) {
  const handle: LogReadable = {
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

  describe("readLogFrom()", () => {
    it("reads a complete UTF-8 log at the byte limit across short reads", async () => {
      const content = encode("hello 😀");
      await expect(readLogFrom(fakeHandle(content, 3), content.length)).resolves.toEqual({
        text: "hello 😀",
        totalBytes: content.length,
      });
    });

    it("skips an oversized file before reading or allocating its contents (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      const handle = { stat: async () => ({ size: Number.MAX_SAFE_INTEGER }), read: jest.fn() };
      await expect(readLogFrom(handle, 64 * 1024 * 1024)).resolves.toEqual({
        text: "",
        totalBytes: Number.MAX_SAFE_INTEGER,
      });
      expect(handle.read).not.toHaveBeenCalled();
    });

    it("does not include bytes appended after the file was sized (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      await expect(readLogFrom(fakeHandle(encode("start appended"), 3, 5), 20)).resolves.toEqual({
        text: "start",
        totalBytes: 5,
      });
    });

    it("decodes only the bytes read when a file shrinks (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      await expect(readLogFrom(fakeHandle(encode("survivor"), 3, 20), 20)).resolves.toEqual({
        text: "survivor",
        totalBytes: 20,
      });
    });

    it.each([
      ["an empty file", fakeHandle(new Uint8Array())],
      ["a file emptied after sizing", fakeHandle(new Uint8Array(), 3, 20)],
    ])(
      "reports zero bytes for %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)",
      async (_case, handle) => {
        await expect(readLogFrom(handle, 20)).resolves.toEqual({ text: "", totalBytes: 0 });
      }
    );
  });
});

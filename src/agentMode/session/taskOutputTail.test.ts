import {
  createNodeTaskOutputReader,
  lastOutputLine,
  TaskOutputTail,
  type TaskOutputReader,
} from "@/agentMode/session/taskOutputTail";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ISSUE_749 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/749";
const PATH = "/tmp/tasks/b1.output";

function memoryReader(initial = "") {
  let bytes = new TextEncoder().encode(initial);
  let exists = initial.length > 0;
  const reads: Array<{ start: number; length: number }> = [];
  const reader: TaskOutputReader = {
    size: async () => (exists ? bytes.length : null),
    read: async (_path, start, length) => {
      reads.push({ start, length });
      return bytes.slice(start, start + length);
    },
  };
  return {
    reader,
    reads,
    append(text: string | Uint8Array) {
      const added = typeof text === "string" ? new TextEncoder().encode(text) : text;
      const next = new Uint8Array(bytes.length + added.length);
      next.set(bytes);
      next.set(added, bytes.length);
      bytes = next;
      exists = true;
    },
    replace(text: string) {
      bytes = new TextEncoder().encode(text);
    },
  };
}

describe("taskOutputTail", () => {
  describe("TaskOutputTail", () => {
    describe("poll()", () => {
      it(`returns the output so far, then only reads what was appended since (${ISSUE_749})`, async () => {
        const file = memoryReader("line 1\n");
        const tail = new TaskOutputTail(PATH, 1024, file.reader);

        const first = await tail.poll();
        file.append("line 2\n");
        const second = await tail.poll();

        expect(first).toEqual({ text: "line 1\n", truncated: false });
        expect(second).toEqual({ text: "line 1\nline 2\n", truncated: false });
        expect(file.reads).toEqual([
          { start: 0, length: 7 },
          { start: 7, length: 7 },
        ]);
      });

      it("returns no output while the file does not exist yet, and reads nothing when it has not grown", async () => {
        const file = memoryReader();
        const tail = new TaskOutputTail(PATH, 1024, file.reader);

        const missing = await tail.poll();
        file.append("ready\n");
        await tail.poll();
        const unchanged = await tail.poll();

        expect(missing).toEqual({ text: "", truncated: false });
        expect(unchanged.text).toBe("ready\n");
        expect(file.reads).toHaveLength(1);
      });

      it(`keeps only the newest whole lines within the cap and marks the output truncated (${ISSUE_749})`, async () => {
        const file = memoryReader("aaaa\nbbbb\ncccc\n");
        const tail = new TaskOutputTail(PATH, 12, file.reader);

        const first = await tail.poll();
        file.append("dd\n");
        const second = await tail.poll();

        expect(first).toEqual({ text: "bbbb\ncccc\n", truncated: true });
        expect(file.reads[0]).toEqual({ start: 3, length: 12 });
        expect(second).toEqual({ text: "cccc\ndd\n", truncated: true });
      });

      it("drops the oldest lines once appended output passes the cap", async () => {
        const file = memoryReader("aaaa\n");
        const tail = new TaskOutputTail(PATH, 10, file.reader);
        await tail.poll();

        file.append("bbbb\ncccc\n");
        const next = await tail.poll();

        expect(next).toEqual({ text: "cccc\n", truncated: true });
      });

      it(`keeps the newest part of a single line longer than the cap instead of showing no output (${ISSUE_749})`, async () => {
        const file = memoryReader("x".repeat(20) + "\n");
        const tail = new TaskOutputTail(PATH, 8, file.reader);

        const snapshot = await tail.poll();

        expect(snapshot).toEqual({ text: "xxxxxxx\n", truncated: true });
      });

      it("decodes a character split across two reads", async () => {
        const file = memoryReader();
        const tail = new TaskOutputTail(PATH, 1024, file.reader);
        const euro = new TextEncoder().encode("€");
        file.append("price ");
        file.append(euro.slice(0, 2));
        const partial = await tail.poll();

        file.append(euro.slice(2));
        file.append("\n");
        const next = await tail.poll();

        expect(partial.text).toBe("price ");
        expect(next.text).toBe("price €\n");
      });

      it("starts over when the file shrinks", async () => {
        const file = memoryReader("old output\n");
        const tail = new TaskOutputTail(PATH, 1024, file.reader);
        await tail.poll();

        file.replace("new\n");
        const next = await tail.poll();

        expect(next).toEqual({ text: "new\n", truncated: false });
      });
    });
  });

  describe("lastOutputLine()", () => {
    it("returns the last line with text, ignoring trailing blank lines", () => {
      expect(lastOutputLine("line 1\nline 2\n\n  \n")).toBe("line 2");
    });

    it("returns an empty string for empty output", () => {
      expect(lastOutputLine("")).toBe("");
    });
  });

  describe("createNodeTaskOutputReader()", () => {
    it("reads a byte range of a file outside the vault and reports a missing file as having no size", async () => {
      const dir = await mkdtemp(join(tmpdir(), "task-output-"));
      try {
        const path = join(dir, "b1.output");
        await writeFile(path, "line 1\nline 2\n");
        const reader = createNodeTaskOutputReader();

        const size = await reader.size(path);
        const bytes = await reader.read(path, 7, 7);
        const missing = await reader.size(join(dir, "missing.output"));

        expect(size).toBe(14);
        expect(new TextDecoder().decode(bytes)).toBe("line 2\n");
        expect(missing).toBeNull();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});

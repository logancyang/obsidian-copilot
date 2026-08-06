import {
  assembleReportBundle,
  buildLinkedReportIssueUrl,
  buildReportMarkdown,
  readTailFrom,
  zipReportBundle,
  type AssembledReport,
  type AttachmentOutcome,
  type ReportInput,
  type ReportIssueDraft,
  type ReportRuntime,
  type TailReadable,
} from "@/utils/issueReport";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";

// Spied, not replaced: the real implementation still runs, so every case that
// inspects the packed zip keeps working. What this buys is the ability to
// assert `zipSync` was never *reached* — the whole point of validating before
// packing is skipping a synchronous compress that freezes the renderer, and
// only the call itself can witness that.
jest.mock("fflate", () => {
  const actual = jest.requireActual<typeof import("fflate")>("fflate");
  return { ...actual, zipSync: jest.fn(actual.zipSync) };
});

beforeEach(() => {
  (zipSync as jest.Mock).mockClear();
});

const BUNDLE_DIR = "/tmp/reports/copilot-report-20260615-101500-abcd";
/** Mirrors the assembler's own budget: 24 MiB total, less the report.md reserve. */
const LOG_BUDGET_BYTES = 24 * 1024 * 1024 - (64 + 8) * 1024;
/** Mirrors the assembler's own note cap. */
const MAX_NOTE_BYTES = 64 * 1024;

/** Every seeded log carries a home path and a secret so redaction is observable. */
const SECRET_LOG = "log line for /Users/alice/vault key sk-abcdef0123456789\n";

function makeRuntime(overrides: Partial<ReportRuntime> = {}) {
  const writes: Array<{ path: string; data: Uint8Array }> = [];
  const mkdirs: string[] = [];
  const removed: string[] = [];
  const files = new Map<string, string>([
    ["/tmp/acp-frames.ndjson", SECRET_LOG],
    ["/tmp/opencode/log/session.log", SECRET_LOG],
  ]);

  const runtime: ReportRuntime = {
    join: (...parts) => parts.join("/"),
    mkdir: async (p) => {
      mkdirs.push(p);
    },
    writeFile: async (p, data) => {
      writes.push({ path: p, data });
      files.set(p, new TextDecoder().decode(data));
    },
    readBytes: async (p) => {
      const content = files.get(p);
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return new TextEncoder().encode(content);
    },
    sizeOf: async (p) => {
      const content = files.get(p);
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return new TextEncoder().encode(content).length;
    },
    readTail: async (p, maxBytes) => {
      const content = files.get(p);
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      const encoded = new TextEncoder().encode(content);
      const tail = encoded.subarray(Math.max(0, encoded.length - maxBytes));
      return { text: new TextDecoder().decode(tail), totalBytes: encoded.length };
    },
    remove: async (p) => {
      removed.push(p);
      for (const path of [...files.keys()]) {
        if (path === p || path.startsWith(`${p}/`)) files.delete(path);
      }
    },
    ...overrides,
  };
  return { runtime, writes, mkdirs, removed, files };
}

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

function writtenText(writes: Array<{ path: string; data: Uint8Array }>, suffix: string) {
  const found = writes.find((w) => w.path.endsWith(suffix));
  return found ? new TextDecoder().decode(found.data) : "";
}

function outcome(report: AssembledReport, id: string): AttachmentOutcome {
  const found = report.attachments.find((a) => a.id === id);
  if (!found) throw new Error(`no attachment outcome for "${id}"`);
  return found;
}

/** Pseudorandom bytes, so deflate has nothing to compress away. */
function incompressibleBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = 0x9e3779b9;
  for (let i = 0; i < length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[i] = state & 0xff;
  }
  return bytes;
}

const MIB = 1024 * 1024;
/** Just past GitHub's 25 MB ceiling, so a pack of this much always has to fail. */
const OVER_LIMIT_BYTES = 25 * MIB + 256 * 1024;

/**
 * An already-assembled bundle whose files are incompressible, so deflate cannot
 * shrink them back under the ceiling — which is the point: the assembler budgets
 * pre-redaction sizes, so only measuring the packed result catches a bundle
 * GitHub would reject.
 */
function oversizedReport(
  sources: Array<{ id: string; name: string; bytes: number; sizeOnDisk?: number }>
) {
  // Sizes, not bytes. These cases describe folders far larger than the budget,
  // and a case that proves the packer turned one away unread would otherwise pay
  // to build the very bytes it is asserting never get touched — hundreds of MB
  // per run, in a suite Jest fans out across workers. Materialized on read.
  const sizes = new Map<string, number>();
  const attachments: AttachmentOutcome[] = sources.map(({ id, name, bytes, sizeOnDisk }) => {
    const absPath = `${BUNDLE_DIR}/${name}`;
    // `sizeOnDisk` diverges from `bytes` to model the staging folder after the
    // user edited it: the manifest still records what the assembler wrote.
    sizes.set(absPath, sizeOnDisk ?? bytes);
    return { id, name, absPath, bytes, status: "included" };
  });
  const sizeAt = (p: string): number => {
    const found = sizes.get(p);
    if (found === undefined) throw new Error(`ENOENT: ${p}`);
    return found;
  };
  const { runtime, writes } = makeRuntime({
    readBytes: async (p) => incompressibleBytes(sizeAt(p)),
    // Same backing store as `readBytes`: the packer weighs the folder before it
    // reads it, so a size probe that disagreed with the bytes would exercise a
    // situation the filesystem cannot produce.
    sizeOf: async (p) => sizeAt(p),
  });
  const report: AssembledReport = { folderPath: BUNDLE_DIR, attachments };
  return { report, runtime, writes };
}

const baseInput: ReportInput = {
  note: "Agent crashed when I clicked run",
  env: {
    pluginVersion: "1.2.3",
    platform: "darwin",
    obsidianVersion: "1.5.0",
    activeBackend: "opencode",
  },
  screenshotRequested: true,
  screenshotPng: new Uint8Array([1, 2, 3]),
  logs: [
    { id: "activityLog", name: "acp-frames.ndjson.txt", path: "/tmp/acp-frames.ndjson" },
    { id: "opencodeLog", name: "opencode.log", path: "/tmp/opencode/log/session.log" },
  ],
  reportsRootDir: "/tmp/reports",
  bundleId: "20260615-101500-abcd",
};

/**
 * Report bundles hold an unredacted screenshot and the user's own prose, and on
 * Linux they land in a `/tmp` shared with every other account on the machine.
 * These run against real files because the narrowing lives in the production
 * Node runtime, and the mode bits are what a second local user would see.
 */
function onRealFilesystem() {
  let root = "";

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-report-test-"));
    // Deliberately world-readable, standing in for the shared `/tmp` this has to
    // survive: the narrowing must come from the code under test, not the fixture.
    await fs.chmod(root, 0o755);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const modeOf = async (target: string) => (await fs.stat(target)).mode & 0o777;

  // Self-contained: `baseInput`'s logs are absolute paths under `/tmp`, and a
  // machine that happens to have those files would pack its real ones — up to
  // the whole budget of unrelated content, making these runs depend on the host.
  const inlineInput = (reportsRootDir: string): ReportInput => ({
    ...baseInput,
    logs: [{ id: "chatLog", name: "copilot-chat-log.md", text: "a chat log" }],
    reportsRootDir,
  });

  it("leaves the staging folder and its files unreadable to other local users", async () => {
    const report = await assembleReportBundle(inlineInput(root));

    expect(await modeOf(report.folderPath)).toBe(0o700);
    for (const name of ["report.md", "screenshot.png", "copilot-chat-log.md"]) {
      expect([name, await modeOf(path.join(report.folderPath, name))]).toEqual([name, 0o600]);
    }
  });

  it("leaves the zip unreadable to other local users", async () => {
    // The zip sits beside the staging folder, not inside it, so the folder's own
    // mode does not cover it — it is also the single file the whole report gets
    // condensed into, and the one the user is invited to drag out.
    const report = await assembleReportBundle(inlineInput(root));

    const { zipPath } = await zipReportBundle(report);

    expect(await modeOf(zipPath)).toBe(0o600);
  });

  it("re-narrows a file left behind world-readable by an earlier report", async () => {
    // `writeFile`'s creation mode is ignored when the file already exists, so a
    // bundle id colliding with a permissive leftover would otherwise inherit it.
    const folderPath = path.join(root, `copilot-report-${baseInput.bundleId}`);
    await fs.mkdir(folderPath, { recursive: true });
    await fs.writeFile(path.join(folderPath, "report.md"), "stale");
    await fs.chmod(path.join(folderPath, "report.md"), 0o644);

    const report = await assembleReportBundle(inlineInput(root));

    expect(await modeOf(path.join(report.folderPath, "report.md"))).toBe(0o600);
  });
}

describe("issueReport", () => {
  describe("assembleReportBundle()", () => {
    it("writes every requested source into a folder named after the bundle id", async () => {
      const { runtime, writes, mkdirs } = makeRuntime();
      const report = await assembleReportBundle(baseInput, runtime);

      expect(report.folderPath).toBe(BUNDLE_DIR);
      expect(mkdirs).toContain(BUNDLE_DIR);
      expect(report.attachments.map((a) => a.id)).toEqual([
        "report",
        "screenshot",
        "activityLog",
        "opencodeLog",
      ]);
      expect(report.attachments.every((a) => a.status === "included")).toBe(true);
      expect(writes.map((w) => w.path)).toContain(`${BUNDLE_DIR}/screenshot.png`);
      expect(writes.map((w) => w.path)).toContain(`${BUNDLE_DIR}/report.md`);
    });

    it("reports the absolute path and byte count of each included attachment", async () => {
      const { runtime } = makeRuntime();
      const report = await assembleReportBundle(baseInput, runtime);

      const screenshot = outcome(report, "screenshot");
      expect(screenshot.absPath).toBe(`${BUNDLE_DIR}/screenshot.png`);
      expect(screenshot.bytes).toBe(3);
      expect(outcome(report, "activityLog").bytes).toBeGreaterThan(0);
    });

    it("redacts log text rather than copying it verbatim", async () => {
      const { runtime, writes } = makeRuntime();
      await assembleReportBundle(baseInput, runtime);

      for (const name of ["acp-frames.ndjson.txt", "opencode.log"]) {
        const text = writtenText(writes, name);
        expect(text).toContain("/Users/<user>/vault");
        expect(text).toContain("<secret>");
        expect(text).not.toContain("/Users/alice");
        expect(text).not.toContain("sk-abcdef0123456789");
      }
    });

    it("redacts an in-memory chat log the same way as one read from disk", async () => {
      const { runtime, writes } = makeRuntime();
      const report = await assembleReportBundle(
        {
          ...baseInput,
          logs: [{ id: "chatLog", name: "copilot-chat-log.md", text: SECRET_LOG }],
        },
        runtime
      );

      expect(outcome(report, "chatLog").status).toBe("included");
      const text = writtenText(writes, "copilot-chat-log.md");
      expect(text).toContain("<secret>");
      expect(text).not.toContain("sk-abcdef0123456789");
    });

    it("records a skip when a requested screenshot could not be captured", async () => {
      const { runtime, writes } = makeRuntime();
      const report = await assembleReportBundle({ ...baseInput, screenshotPng: null }, runtime);

      const screenshot = outcome(report, "screenshot");
      expect(screenshot.status).toBe("skipped");
      expect(screenshot.absPath).toBeNull();
      expect(screenshot.reason).toContain("No screenshot");
      expect(writes.map((w) => w.path)).not.toContain(`${BUNDLE_DIR}/screenshot.png`);
    });

    it("omits the screenshot entirely when it was never requested", async () => {
      const { runtime } = makeRuntime();
      const report = await assembleReportBundle(
        { ...baseInput, screenshotRequested: false, screenshotPng: null },
        runtime
      );

      expect(report.attachments.map((a) => a.id)).not.toContain("screenshot");
    });

    it("records a failure with the write error when the screenshot cannot be saved", async () => {
      const { runtime } = makeRuntime({
        writeFile: async (p) => {
          if (p.endsWith("screenshot.png")) throw new Error("EACCES");
        },
      });
      const report = await assembleReportBundle(baseInput, runtime);

      const screenshot = outcome(report, "screenshot");
      expect(screenshot.status).toBe("failed");
      expect(screenshot.reason).toContain("EACCES");
    });

    it("records the caller's reason when a requested log has no content to read", async () => {
      const { runtime } = makeRuntime();
      const report = await assembleReportBundle(
        {
          ...baseInput,
          logs: [
            {
              id: "opencodeLog",
              name: "opencode.log",
              unavailableReason: "No OpenCode log was found.",
            },
          ],
        },
        runtime
      );

      const log = outcome(report, "opencodeLog");
      expect(log.status).toBe("skipped");
      expect(log.reason).toBe("No OpenCode log was found.");
    });

    it("fails only the unreadable log and still includes the others", async () => {
      const { runtime } = makeRuntime({
        readTail: async (p) => {
          if (p.includes("acp-frames")) throw new Error("ENOENT: rotated away");
          return { text: SECRET_LOG, totalBytes: SECRET_LOG.length };
        },
      });
      const report = await assembleReportBundle(baseInput, runtime);

      const activity = outcome(report, "activityLog");
      expect(activity.status).toBe("failed");
      expect(activity.reason).toContain("rotated away");
      expect(outcome(report, "opencodeLog").status).toBe("included");
      expect(outcome(report, "report").status).toBe("included");
    });

    it("skips an empty log instead of bundling a zero-byte file", async () => {
      const { runtime } = makeRuntime({
        readTail: async () => ({ text: "", totalBytes: 0 }),
      });
      const report = await assembleReportBundle(baseInput, runtime);

      expect(outcome(report, "activityLog").status).toBe("skipped");
      expect(outcome(report, "activityLog").reason).toContain("empty");
    });

    it("keeps only the newest slice of an oversized log and labels the gap", async () => {
      const { runtime, writes } = makeRuntime({
        // Mirrors the real runtime: it returns at most `maxBytes` of tail plus
        // the file's true size, which is what marks the result as partial.
        readTail: async () => ({
          text: "cut-off first line\nnewest entry\n",
          totalBytes: 40 * 1024 * 1024,
        }),
      });
      const report = await assembleReportBundle(baseInput, runtime);

      const activity = outcome(report, "activityLog");
      expect(activity.status).toBe("included");
      expect(activity.truncated).toBe(true);

      const text = writtenText(writes, "acp-frames.ndjson.txt");
      expect(text).toContain("earlier entries omitted");
      expect(text).toContain("newest entry");
      // The partial leading line is dropped so no half record survives.
      expect(text).not.toContain("cut-off first line");
    });

    it("truncates an in-memory log by bytes so multi-byte characters cannot overshoot", async () => {
      const { runtime, writes } = makeRuntime();
      // Each character is 3 UTF-8 bytes, so a character-based cap would write
      // three times the budget.
      const bigText = "行\n".repeat(LOG_BUDGET_BYTES / 2);
      const report = await assembleReportBundle(
        {
          ...baseInput,
          screenshotRequested: false,
          screenshotPng: null,
          logs: [{ id: "chatLog", name: "copilot-chat-log.md", text: bigText }],
        },
        runtime
      );

      const chatLog = outcome(report, "chatLog");
      expect(chatLog.truncated).toBe(true);
      expect(writtenText(writes, "copilot-chat-log.md").length).toBeLessThan(bigText.length);
    });

    it("skips later logs once earlier attachments have used up the size budget", async () => {
      const { runtime } = makeRuntime();
      const report = await assembleReportBundle(
        { ...baseInput, screenshotPng: new Uint8Array(LOG_BUDGET_BYTES) },
        runtime
      );

      expect(outcome(report, "screenshot").status).toBe("included");
      const activity = outcome(report, "activityLog");
      expect(activity.status).toBe("skipped");
      expect(activity.reason).toContain("No room left");
    });

    it("still includes a small log that fits in a budget too small for a useful tail", async () => {
      const { runtime, writes } = makeRuntime();
      // Leaves well under the minimum tail, but far more than this log needs.
      const screenshot = new Uint8Array(LOG_BUDGET_BYTES - 4 * 1024);
      const smallLog = "a chat log worth reading\n".repeat(20);

      const report = await assembleReportBundle(
        {
          ...baseInput,
          screenshotPng: screenshot,
          logs: [{ id: "chatLog", name: "copilot-chat-log.md", text: smallLog }],
        },
        runtime
      );

      // The floor exists to reject a tail too short to show context, not a
      // complete log — which is often the most diagnostic thing in the bundle.
      const chatLog = outcome(report, "chatLog");
      expect(chatLog.status).toBe("included");
      expect(chatLog.truncated).toBe(false);
      expect(writtenText(writes, "copilot-chat-log.md")).toContain("a chat log worth reading");
    });

    it("refuses to assemble when the untrimmable screenshot alone exceeds the limit", async () => {
      const { runtime } = makeRuntime();
      await expect(
        assembleReportBundle(
          { ...baseInput, screenshotPng: new Uint8Array(25 * 1024 * 1024) },
          runtime
        )
      ).rejects.toThrow(/screenshot alone is .* over the .* report limit/);
    });

    it("fails the whole assembly when report.md cannot be written", async () => {
      const { runtime } = makeRuntime({
        writeFile: async (p) => {
          if (p.endsWith("report.md")) throw new Error("EROFS");
        },
      });
      await expect(assembleReportBundle(baseInput, runtime)).rejects.toThrow("EROFS");
    });

    it("fails the whole assembly when the bundle folder cannot be created", async () => {
      const { runtime } = makeRuntime({
        mkdir: async () => {
          throw new Error("EACCES");
        },
      });
      await expect(assembleReportBundle(baseInput, runtime)).rejects.toThrow("EACCES");
    });

    it("writes report.md even when every optional source is unavailable", async () => {
      const { runtime, writes } = makeRuntime();
      const report = await assembleReportBundle(
        { ...baseInput, screenshotRequested: false, screenshotPng: null, logs: [] },
        runtime
      );

      expect(report.attachments.map((a) => a.id)).toEqual(["report"]);
      expect(writtenText(writes, "report.md")).toContain("Agent crashed when I clicked run");
    });

    it("records each source's status in report.md so the issue reflects what landed", async () => {
      const { runtime, writes } = makeRuntime();
      await assembleReportBundle(
        {
          ...baseInput,
          screenshotPng: null,
          logs: [
            { id: "activityLog", name: "acp-frames.ndjson.txt", path: "/tmp/acp-frames.ndjson" },
          ],
        },
        runtime
      );

      const md = writtenText(writes, "report.md");
      expect(md).toContain("- acp-frames.ndjson.txt");
      expect(md).toContain("- screenshot.png — skipped: No screenshot could be captured.");
    });

    it("redacts the user's description before it is written into report.md", async () => {
      const { runtime, writes } = makeRuntime();
      await assembleReportBundle(
        {
          ...baseInput,
          note: "crashed while indexing /Users/alice/vault with sk-abcdef0123456789",
        },
        runtime
      );

      const md = writtenText(writes, "report.md");
      expect(md).toContain("/Users/<user>/vault");
      expect(md).toContain("<secret>");
      expect(md).not.toContain("/Users/alice");
      expect(md).not.toContain("sk-abcdef0123456789");
    });

    it("redacts an attachment's failure reason so a failing path cannot name the user", async () => {
      const { runtime, writes } = makeRuntime({
        readTail: async () => {
          throw new Error("EACCES: open '/Users/alice/Library/logs/acp.ndjson'\nretry later");
        },
      });
      const report = await assembleReportBundle(baseInput, runtime);

      const reason = outcome(report, "activityLog").reason ?? "";
      expect(reason).toContain("/Users/<user>/Library");
      expect(reason).not.toContain("/Users/alice");
      // One line, because it lands inside a markdown bullet list.
      expect(reason).not.toContain("\n");
      expect(writtenText(writes, "report.md")).not.toContain("/Users/alice");
    });

    it("caps a runaway failure reason instead of letting it eat the report budget", async () => {
      const { runtime } = makeRuntime({
        readTail: async () => {
          throw new Error("x".repeat(50_000));
        },
      });
      const report = await assembleReportBundle(baseInput, runtime);

      const reason = outcome(report, "activityLog").reason ?? "";
      expect(reason.length).toBeLessThan(1100);
      expect(reason.endsWith("…")).toBe(true);
    });

    it("refuses to write a report.md that overruns the budget set aside for it", async () => {
      // The note is already at its own cap, so enough failing sources push the
      // attachment list past the headroom left for it.
      const { runtime } = makeRuntime({
        readTail: async () => {
          throw new Error("y".repeat(50_000));
        },
      });
      const logs = Array.from({ length: 20 }, (_unused, i) => ({
        id: `log${i}`,
        name: `log${i}.txt`,
        path: "/tmp/acp-frames.ndjson",
      }));

      await expect(
        assembleReportBundle(
          { ...baseInput, note: "A".repeat(MAX_NOTE_BYTES), screenshotRequested: false, logs },
          runtime
        )
      ).rejects.toThrow(/report summary came out .* over the .* set aside for it/);
    });

    it("removes the staging folder when the assembly fails, leaving no plaintext behind", async () => {
      const { runtime, removed } = makeRuntime({
        writeFile: async (p) => {
          if (p.endsWith("report.md")) throw new Error("EROFS");
        },
      });

      await expect(assembleReportBundle(baseInput, runtime)).rejects.toThrow("EROFS");
      expect(removed).toContain(BUNDLE_DIR);
    });

    it("skips a half character at the start of a tail so no replacement glyph is bundled", async () => {
      // The log has no newline at all, so the truncation banner cannot drop the
      // partial leading line — the decode itself has to keep the glyph out.
      const tailBudget = 100 * 1024 + 1; // not a multiple of the emoji's 4 bytes
      const { runtime, writes } = makeRuntime();
      const report = await assembleReportBundle(
        {
          ...baseInput,
          screenshotPng: new Uint8Array(LOG_BUDGET_BYTES - tailBudget),
          logs: [{ id: "chatLog", name: "copilot-chat-log.md", text: "😀".repeat(50_000) }],
        },
        runtime
      );

      expect(outcome(report, "chatLog").truncated).toBe(true);
      expect(writtenText(writes, "copilot-chat-log.md")).not.toContain("�");
    });

    // Exercises the real Node runtime rather than the injected fake: the mode
    // bits are applied there, so a fake would only be asserting itself. POSIX
    // only — Windows has no mode bits and the production code logs and moves on.
    (process.platform === "win32" ? describe.skip : describe)(
      "on the real filesystem",
      onRealFilesystem
    );
  });

  describe("zipReportBundle()", () => {
    it("packs only the included attachments into a zip beside the staging folder", async () => {
      const { runtime, writes } = makeRuntime();
      const report = await assembleReportBundle({ ...baseInput, screenshotPng: null }, runtime);

      const { zipPath, bytes } = await zipReportBundle(report, runtime);

      expect(zipPath).toBe(`${BUNDLE_DIR}.zip`);
      expect(bytes).toBeGreaterThan(0);
      const zip = writes.find((w) => w.path === zipPath);
      expect(zip).toBeDefined();
      // Entry names live in the zip's central directory as plain text.
      const raw = new TextDecoder().decode(zip?.data ?? new Uint8Array());
      expect(raw).toContain("report.md");
      expect(raw).toContain("acp-frames.ndjson.txt");
      expect(raw).not.toContain("screenshot.png");
    });

    it("fails rather than producing a zip missing a file it promised to include", async () => {
      const { runtime, files } = makeRuntime();
      const report = await assembleReportBundle(baseInput, runtime);
      files.delete(`${BUNDLE_DIR}/screenshot.png`);

      await expect(zipReportBundle(report, runtime)).rejects.toThrow("ENOENT");
    });

    it("reports the sizes it just read, so a repack after the user edits the folder is reflected", async () => {
      const { runtime, files } = makeRuntime();
      const report = await assembleReportBundle(baseInput, runtime);
      files.set(`${BUNDLE_DIR}/acp-frames.ndjson.txt`, "trimmed");

      const packed = await zipReportBundle(report, runtime);

      const activity = packed.attachments.find((a) => a.id === "activityLog");
      expect(activity?.bytes).toBe("trimmed".length);
      // Sources that never made it in keep their original outcome.
      expect(packed.attachments.map((a) => a.id)).toEqual(report.attachments.map((a) => a.id));
    });

    it("rebuilds the issue draft and manual URL from the report.md it just packed", async () => {
      const { runtime, files } = makeRuntime();
      const report = await assembleReportBundle(baseInput, runtime);
      // What the user does in the staging folder when the scrub missed
      // something: open `report.md` and take the sensitive line out.
      files.set(`${BUNDLE_DIR}/report.md`, "## What went wrong\n\nRedacted by hand.\n");

      const packed = await zipReportBundle(report, runtime);

      // Publishing the pre-edit body would put back exactly what they removed.
      expect(packed.issueDraft.body).toContain("Redacted by hand.");
      expect(packed.issueDraft.body).not.toContain("Agent crashed when I clicked run");
      const urlBody = new URLSearchParams(packed.manualIssueUrl.split("?")[1]).get("body") ?? "";
      expect(urlBody).toContain("Redacted by hand.");
      expect(urlBody).not.toContain("Agent crashed when I clicked run");
    });

    it("re-cuts the title from the edited note, so a removed first line cannot stay in it", async () => {
      const { runtime, files } = makeRuntime();
      const report = await assembleReportBundle(baseInput, runtime);
      files.set(`${BUNDLE_DIR}/report.md`, "## What went wrong\n\nSomething broke.\n");

      const packed = await zipReportBundle(report, runtime);

      // The title is cut from the same text the body is. Carrying the old one
      // over would publish, as the issue's title, the line the user just
      // deleted from the note.
      expect(packed.issueDraft.title).toBe("[Agent Mode] Something broke.");
      expect(packed.manualIssueUrl).not.toContain("Agent+crashed");
      // Headings are skipped: the title has to carry the description, not the
      // template's own "## What went wrong".
      expect(packed.issueDraft.title).not.toContain("What went wrong");
    });

    it("falls back to a generic title when the edited note has no prose left", async () => {
      const { runtime, files } = makeRuntime();
      const report = await assembleReportBundle(baseInput, runtime);
      files.set(`${BUNDLE_DIR}/report.md`, "## What went wrong\n\n");

      const packed = await zipReportBundle(report, runtime);

      expect(packed.issueDraft.title).toBe("[Agent Mode] Issue report");
    });

    it("redacts a hand-edited report.md again before it can reach the issue body", async () => {
      const { runtime, files } = makeRuntime();
      const report = await assembleReportBundle(baseInput, runtime);
      // Whatever the user typed while editing never went through `redactLogText`.
      files.set(`${BUNDLE_DIR}/report.md`, "## What went wrong\n\nkey sk-abcdef0123456789\n");

      const packed = await zipReportBundle(report, runtime);

      expect(packed.issueDraft.body).toContain("<secret>");
      expect(packed.issueDraft.body).not.toContain("sk-abcdef0123456789");
      expect(packed.manualIssueUrl).not.toContain("sk-abcdef0123456789");
      // The title comes off the same redacted text, so it cannot leak either.
      expect(packed.issueDraft.title).not.toContain("sk-abcdef0123456789");
    });

    it("refuses to build an issue from a bundle whose report.md grew past its budget", async () => {
      const { runtime, files, writes } = makeRuntime();
      const report = await assembleReportBundle(baseInput, runtime);
      // The staging folder is the user's to edit, so `report.md` can come back
      // arbitrarily larger than the assembler ever wrote.
      files.set(`${BUNDLE_DIR}/report.md`, "x".repeat((64 + 8) * 1024 + 1));

      await expect(zipReportBundle(report, runtime)).rejects.toThrow(/report summary is allowed/);
      // Not merely "no zip on disk": the whole point of validating first is to
      // skip the synchronous pack, which is what freezes the renderer. An
      // assertion on `writes` alone would still pass if the check moved back
      // to after `zipSync`.
      expect(zipSync).not.toHaveBeenCalled();
      expect(writes.some((w) => w.path.endsWith(".zip"))).toBe(false);
    });

    it("writes no zip when the bundle it was handed has no report.md", async () => {
      const { runtime, writes } = makeRuntime();
      const report = await assembleReportBundle(baseInput, runtime);

      await expect(
        zipReportBundle(
          { ...report, attachments: report.attachments.filter((a) => a.id !== "report") },
          runtime
        )
      ).rejects.toThrow(/no report\.md/);
      expect(zipSync).not.toHaveBeenCalled();
      expect(writes.some((w) => w.path.endsWith(".zip"))).toBe(false);
    });

    /** The manual URL for a bundle assembled from `input`. */
    async function manualUrlFor(input: ReportInput) {
      const { runtime } = makeRuntime();
      const report = await assembleReportBundle(input, runtime);
      return (await zipReportBundle(report, runtime)).manualIssueUrl;
    }

    it("returns a manual URL targeting the public repo, with an encoded title and body", async () => {
      const url = await manualUrlFor(baseInput);
      expect(url.startsWith("https://github.com/logancyang/obsidian-copilot/issues/new?")).toBe(
        true
      );
      expect(url.includes("obsidian-copilot-preview")).toBe(false);
      const params = new URLSearchParams(url.split("?")[1]);
      expect(params.get("title")).toBe("[Agent Mode] Agent crashed when I clicked run");
      expect(params.get("labels")).toBe("bug");
      expect(params.get("body")).toContain("Agent crashed when I clicked run");
    });

    it("titles the manual URL generically when the note is blank", async () => {
      const url = await manualUrlFor({ ...baseInput, note: "" });
      const params = new URLSearchParams(url.split("?")[1]);
      expect(params.get("title")).toBe("[Agent Mode] Issue report");
    });

    it("truncates the manual URL's body to stay under the Windows openExternal limit", async () => {
      const url = await manualUrlFor({ ...baseInput, note: "x".repeat(10000) });
      // Comfortably under Electron's ~2081-char Windows ceiling for openExternal.
      expect(url.length).toBeLessThanOrEqual(2081);
      const params = new URLSearchParams(url.split("?")[1]);
      expect(params.get("body")).toContain("report truncated");
    });

    it("redacts the title cut from the note, which leaves the machine before any review", async () => {
      const url = await manualUrlFor({
        ...baseInput,
        note: "sk-abcdef0123456789 fails under /Users/alice",
      });
      const title = new URLSearchParams(url.split("?")[1]).get("title") ?? "";

      expect(title).toContain("<secret>");
      expect(title).toContain("/Users/<user>");
      expect(title).not.toContain("sk-abcdef0123456789");
      expect(url).not.toContain("alice");
    });

    it("falls back to a generic title when the description heading is gone entirely", async () => {
      const { runtime, files } = makeRuntime();
      const report = await assembleReportBundle(baseInput, runtime);
      // An edit that removed the heading leaves no section to read, and the
      // lines that remain belong to the environment block — a title cut from
      // those would read "[Agent Mode] - Plugin version: 1.2.3".
      files.set(
        `${BUNDLE_DIR}/report.md`,
        "Stray intro\n\n## Environment\n\n- Plugin version: 1.2.3\n"
      );

      const packed = await zipReportBundle(report, runtime);

      expect(packed.issueDraft.title).toBe("[Agent Mode] Issue report");
    });

    it("leaves no half-written zip behind when the write fails", async () => {
      const { runtime, removed } = makeRuntime();
      const report = await assembleReportBundle(baseInput, runtime);
      const failing = {
        ...runtime,
        writeFile: async (p: string) => {
          if (p.endsWith(".zip")) throw new Error("ENOSPC");
          return runtime.writeFile(p, new Uint8Array());
        },
      };

      await expect(zipReportBundle(report, failing)).rejects.toThrow("ENOSPC");
      expect(removed).toContain(`${BUNDLE_DIR}.zip`);
    });

    it("refuses to write a zip over GitHub's limit and names the biggest source the user may drop", async () => {
      const { report, runtime, writes } = oversizedReport([
        { id: "report", name: "report.md", bytes: 1024 },
        { id: "activityLog", name: "acp-frames.ndjson.txt", bytes: OVER_LIMIT_BYTES - MIB * 6 },
        { id: "chatLog", name: "copilot-chat-log.md", bytes: MIB * 6 - 1024 },
      ]);

      const message = await zipReportBundle(report, runtime).then(
        () => "",
        (err: Error) => err.message
      );

      expect(message).toMatch(/over GitHub's 25\.0 MB attachment limit/);
      expect(message).toContain("acp-frames.ndjson.txt");
      // Naming the smaller optional source would send the user after the wrong one.
      expect(message).not.toContain("copilot-chat-log.md");
      // Unchecking the biggest source is where to start, not a promise that it
      // is enough: these are uncompressed sizes and several may be oversized.
      expect(message).toMatch(/then anything else you can spare/);
      expect(writes).toHaveLength(0);
    });

    it("refuses to read a staging folder too big to hold, before reading any of it", async () => {
      // The UI invites the user to edit the staging folder and repack it, so the
      // manifest's sizes are what the assembler wrote, not what is there now.
      // Weighed against the disk — trusting the stale record would let an edited
      // folder through — and refused before `readBytes`, which is the call that
      // freezes the renderer.
      const { report, runtime, writes } = oversizedReport([
        { id: "report", name: "report.md", bytes: 1024 },
        { id: "activityLog", name: "acp-frames.ndjson.txt", bytes: 1024, sizeOnDisk: MIB * 200 },
      ]);
      runtime.readBytes = async () => {
        throw new Error("READ_SHOULD_NOT_HAPPEN");
      };

      const message = await zipReportBundle(report, runtime).then(
        () => "",
        (err: Error) => err.message
      );

      expect(message).toMatch(/too much to pack without freezing Obsidian/);
      expect(writes).toHaveLength(0);
    });

    it("still reads a staging folder that sits exactly on the ceiling", async () => {
      // Pins which side of the boundary belongs to the refusal: at the ceiling the
      // folder is read and judged like any other, and only what exceeds it is
      // turned away unread. Proven by the read happening rather than by packing
      // 96 MB, which would spend a gigabyte of CI memory to observe one branch.
      // The file shrinking between its `sizeOf` and its `readBytes` is a shape
      // the filesystem really does produce, so the short read is not a cheat.
      const { report, runtime } = oversizedReport([
        { id: "report", name: "report.md", bytes: MIB * 96 },
      ]);
      const readPaths: string[] = [];
      runtime.readBytes = async (p) => {
        readPaths.push(p);
        return new Uint8Array(8);
      };

      const message = await zipReportBundle(report, runtime).then(
        () => "",
        (err: Error) => err.message
      );

      expect(readPaths).toEqual([`${BUNDLE_DIR}/report.md`]);
      expect(message).not.toMatch(/too much to pack/);
    });

    it("never blames report.md, which the user has no way to leave out", async () => {
      // `report.md` stays within the size a report summary is allowed — it is
      // the other sources that blow the limit, which is the only way this can
      // happen now that an oversized note is rejected before packing.
      const { report, runtime } = oversizedReport([
        { id: "report", name: "report.md", bytes: 2048 },
        { id: "activityLog", name: "acp-frames.ndjson.txt", bytes: MIB * 4 },
        { id: "chatLog", name: "copilot-chat-log.md", bytes: OVER_LIMIT_BYTES - MIB * 4 },
      ]);

      const message = await zipReportBundle(report, runtime).then(
        () => "",
        (err: Error) => err.message
      );

      expect(message).toContain("copilot-chat-log.md");
      expect(message).not.toContain("report.md");
    });

    it("rejects an oversized report.md before it can reach the packer at all", async () => {
      // The case this replaced asserted `describeOversizedZip`'s "no source to
      // name" wording, reached by making `report.md` itself 25 MB. That is now
      // unreachable: an oversized note is refused before anything is packed,
      // which is the better failure — it names the one file the user can act on.
      const { report, runtime } = oversizedReport([
        { id: "report", name: "report.md", bytes: 2048, sizeOnDisk: OVER_LIMIT_BYTES },
      ]);

      await expect(zipReportBundle(report, runtime)).rejects.toThrow(/report summary is allowed/);
    });
  });

  describe("buildReportMarkdown()", () => {
    const included = (id: string, name: string): AttachmentOutcome => ({
      id,
      name,
      absPath: `${BUNDLE_DIR}/${name}`,
      bytes: 10,
      status: "included",
    });

    it("includes the note, environment, and attachment list", () => {
      const md = buildReportMarkdown(baseInput, [
        included("report", "report.md"),
        included("screenshot", "screenshot.png"),
      ]);
      expect(md).toContain("Agent crashed when I clicked run");
      expect(md).toContain("- Plugin version: 1.2.3");
      expect(md).toContain("- Active backend: opencode");
      expect(md).toContain("- Platform: darwin");
      expect(md).toContain("- Obsidian: 1.5.0");
      expect(md).toContain("- screenshot.png");
      // report.md never lists itself.
      expect(md).not.toContain("- report.md");
    });

    it("marks a truncated attachment so a reader knows entries are missing", () => {
      const md = buildReportMarkdown(baseInput, [
        { ...included("activityLog", "acp-frames.ndjson.txt"), truncated: true },
      ]);
      expect(md).toContain("acp-frames.ndjson.txt — truncated to the newest entries");
    });

    it("falls back to placeholders when the note is empty and nothing was captured", () => {
      const md = buildReportMarkdown({ ...baseInput, note: "   " }, []);
      expect(md).toContain("_No description provided._");
      expect(md).toContain("(none captured)");
    });

    it("keeps the opening of an oversized note and says so instead of failing", () => {
      const note = "A".repeat(MAX_NOTE_BYTES * 2);
      const md = buildReportMarkdown({ ...baseInput, note }, []);

      expect(md).toContain("description truncated");
      expect(md).toContain("A".repeat(1000));
      expect(new TextEncoder().encode(md).length).toBeLessThan(MAX_NOTE_BYTES + 2048);
    });

    it("cuts an oversized note on a character boundary so no multi-byte character is halved", () => {
      // Each character is 3 UTF-8 bytes, so a cut at the byte cap lands mid-character.
      const note = "行".repeat(MAX_NOTE_BYTES);
      const md = buildReportMarkdown({ ...baseInput, note }, []);

      expect(md).toContain("description truncated");
      // U+FFFD is what a halved sequence decodes to.
      expect(md).not.toContain("�");
    });
  });

  describe("buildLinkedReportIssueUrl()", () => {
    const draft: ReportIssueDraft = {
      title: "[Agent Mode] Agent crashed when I clicked run",
      body: buildReportMarkdown(baseInput, []),
    };
    const shareUrl = "https://copilot-reports.invalid/r/abc123";
    /** Mirrors the module's own `MAX_ISSUE_URL_LENGTH`. */
    const MAX_ISSUE_URL_LENGTH = 1800;

    it("puts the link ahead of the body", () => {
      const url = buildLinkedReportIssueUrl(draft, shareUrl);
      const body = new URLSearchParams(url.split("?")[1]).get("body") ?? "";
      // Near the very front, inside the fixed prefix — not merely present
      // somewhere in a body that truncation could still reach.
      expect(body.indexOf(shareUrl)).toBeLessThan(60);
    });

    it("keeps the link intact — not truncated away — on a note long enough to force truncation", () => {
      const longDraft: ReportIssueDraft = {
        ...draft,
        body: "x".repeat(10000),
      };
      const url = buildLinkedReportIssueUrl(longDraft, shareUrl);
      const body = new URLSearchParams(url.split("?")[1]).get("body") ?? "";

      // The bug this guards: `body.slice(0, keep)` truncates from the end, so
      // a link appended after the body would be the first thing cut from a
      // long note. Prefixing it is what survives that.
      expect(body.indexOf(shareUrl)).toBeGreaterThanOrEqual(0);
      expect(body.indexOf(shareUrl)).toBeLessThan(60);
      expect(url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH);
    });

    it("throws rather than silently exceed the URL cap when the link itself cannot fit", () => {
      const hugeShareUrl = `https://copilot-reports.invalid/r/${"a".repeat(3000)}`;
      expect(() => buildLinkedReportIssueUrl(draft, hugeShareUrl)).toThrow(
        /nothing left to truncate/
      );
    });
  });

  describe("readTailFrom()", () => {
    it("keeps reading until the requested tail is filled rather than trusting one read", async () => {
      const content = new TextEncoder().encode("hello world");
      const result = await readTailFrom(fakeHandle(content, 3), 5);

      expect(result).toEqual({ text: "world", totalBytes: content.length });
    });

    it("decodes only what was actually read when the file shrank after being sized", async () => {
      const content = new TextEncoder().encode("abcdefghij");
      const result = await readTailFrom(fakeHandle(content, content.length, 20), 20);

      // The unfilled remainder of the buffer is NUL, which must not be bundled
      // as if the log contained it.
      expect(result.text).toBe("abcdefghij");
      expect(result.text).not.toContain("\u0000");
      expect(result.totalBytes).toBe(20);
    });

    it("returns an empty tail for a file with nothing in it", async () => {
      const result = await readTailFrom(fakeHandle(new Uint8Array()), 1024);
      expect(result).toEqual({ text: "", totalBytes: 0 });
    });

    it("reports zero total bytes when the file was truncated past the start it planned to read from", async () => {
      const content = new TextEncoder().encode("survivor");
      // Sized at 100 with a 50-byte cap, so the read starts at byte 50; the file
      // has since rotated down to 8 bytes, leaving that start past its new EOF.
      const result = await readTailFrom(fakeHandle(content, content.length, 100), 50);

      // Reporting the stale 100 would have the caller bundle a truncation banner
      // with no log under it and call the source included.
      expect(result).toEqual({ text: "", totalBytes: 0 });
    });

    it("skips a half character at the cut so the tail never starts with a replacement glyph", async () => {
      const content = new TextEncoder().encode("😀😀😀");
      // 6 bytes back lands two bytes into the middle emoji.
      const result = await readTailFrom(fakeHandle(content), 6);

      expect(result.text).toBe("😀");
    });
  });
});

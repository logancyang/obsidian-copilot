import {
  buildLinkedReportIssueUrl,
  buildManualIssueUrl,
  buildReportBundle,
  buildReportMarkdown,
  getNodeReportRuntime,
  MAX_REDACTABLE_LOG_BYTES,
  type AttachmentResult,
  type ReportBundle,
  type ReportInput,
  type ReportLogRequest,
  type ReportRuntime,
} from "@/utils/issueReport";
import { redactLogText } from "@/utils/redactLog";
import { unzipSync, zipSync } from "fflate";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The per-source budget stops 1 MiB short of the packed-zip ceiling, so no
// input can reach that ceiling through the public contract; the one test that
// exercises it substitutes the packer's output. Every other test gets the real
// `zipSync` through the wrapper.
jest.mock("fflate", () => {
  const actual = jest.requireActual<typeof import("fflate")>("fflate");
  return { ...actual, zipSync: jest.fn(actual.zipSync) };
});

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** Mirrors the assembler's own budget: 24 MiB total, less the report.md reserve. */
const LOG_BUDGET_BYTES = 24 * 1024 * 1024 - (64 + 8) * 1024;
/** A per-log budget clear of the 64 KiB floor under which a tail is not worth keeping. */
const TAILABLE_BUDGET_BYTES = 64 * 1024 + 256 + 512;
/** Mirrors the assembler's own note cap. */
const MAX_NOTE_BYTES = 64 * 1024;
const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/202";

/** Every seeded log carries a home path and a secret so redaction is observable. */
const SECRET_LOG = "log line for /Users/alice/vault key sk-abcdef0123456789\n";
const ACTIVITY_PATH = "/tmp/acp-frames.ndjson";
const ACTIVITY_NAME = "acp-frames.ndjson.txt";
const OPENCODE_PATH = "/tmp/opencode/log/session.log";
/**
 * A line redaction lengthens, 83 bytes to 89: the two-letter username becomes
 * `<user>` and the eight-character secret `<redacted>`, so a log of these grows
 * 7% on the way out — enough to carry a slice cut to the budget past it.
 */
const INFLATING_LINE =
  "INFO service=file path=/Users/wy/vault/daily/2026-06-15.md secret=hunter22 read ok\n";

/**
 * A credential whose key and value sit on different lines, placed so the cut
 * at `SPLIT_CREDENTIAL_BUDGET` less the banner reserve lands on the key line:
 * a tail cut before redaction drops that line as its fragment and keeps the
 * value as plain text.
 */
const SPLIT_CREDENTIAL_LOG =
  "old\n".repeat(25_000) + "password=\nsensitivevalue\n" + "e\n".repeat(33_000);
const SPLIT_CREDENTIAL_BUDGET = 66_281;

/** `count` bytes of two-byte `e\n` lines, an odd count closed with a bare `e`. */
const filler = (count: number) => "e\n".repeat(Math.floor(count / 2)) + "e".repeat(count % 2);
/**
 * The bytes a tail read at `TAILABLE_BUDGET_BYTES` plus 8 KiB of context would
 * hold: the shape every window-bounded read has to get right and cannot. The
 * fixtures below place their key exactly one byte in front of such a window.
 */
const WINDOWED_READ_BYTES = TAILABLE_BUDGET_BYTES + 8 * 1024;
/**
 * `password=` sits just before a 72 KiB window whose own contents shrink under
 * redaction (`secret=` followed by 20,000 bytes of key), so the redacted window
 * fits the budget and the cut lands back on the value with no key in view.
 */
const SHRINKING_WINDOW_LOG = (() => {
  let suffix = "\nsensitivevalue\nsecret=" + "x".repeat(20_000) + "\n";
  suffix += filler(73_728 - suffix.length);
  return "old\n".repeat(1000) + "password=" + suffix;
})();
/**
 * The key, its `:` and the value on three lines, with a window that would open
 * on the lone `:` line: no heuristic over the cut-open first line recovers a
 * key that is itself a whole line above the window's start.
 */
const SEPARATOR_LINE_LOG = (() => {
  const window = ":\nsensitivevalue\nsecret=" + "x".repeat(9000) + "\n";
  return "old\n".repeat(1000) + "password\n" + window + filler(WINDOWED_READ_BYTES - window.length);
})();
/**
 * The generic credential rule accepts `secret=` as a value, so a run of bare
 * `secret=` lines pairs up from wherever the text starts: read whole, the
 * even-numbered run leaves the last `secret=` as the key of `sensitivevalue`;
 * read from any line after `password=`, the pairing shifts and the value goes plain.
 */
const CHAINED_KEYS_LOG = (() => {
  const chain = "secret=\n".repeat(1100);
  const rest = chain + "sensitivevalue\n";
  return "password=\n" + rest + filler(WINDOWED_READ_BYTES - rest.length);
})();

/** A runtime whose `readTail` serves the given files and rejects for any other path. */
function runtimeWith(files: Record<string, string>): ReportRuntime {
  return {
    readTail: async (p, maxBytes) => {
      const content = files[p];
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      const encoded = encode(content);
      const tail = encoded.subarray(Math.max(0, encoded.length - maxBytes));
      return { text: decode(tail), totalBytes: encoded.length };
    },
  };
}

const runtime = runtimeWith({ [ACTIVITY_PATH]: SECRET_LOG, [OPENCODE_PATH]: SECRET_LOG });

const rejecting = (err: Error): ReportRuntime => ({
  readTail: () => Promise.reject(err),
});

/** The base runtime with `readTail` swapped out for the activity log alone. */
const forActivityLog = (readTail: ReportRuntime["readTail"]): ReportRuntime => ({
  readTail: (p, max) => (p === ACTIVITY_PATH ? readTail(p, max) : runtime.readTail(p, max)),
});

const baseInput: ReportInput = {
  bundleId: "20260615-101500-abcd",
  note: "Agent crashed when I clicked run",
  env: {
    pluginVersion: "1.2.3",
    platform: "darwin",
    obsidianVersion: "1.5.0",
    activeBackend: "opencode",
  },
  screenshotPng: new Uint8Array([1, 2, 3]),
  logs: [
    { id: "activityLog", name: ACTIVITY_NAME, path: ACTIVITY_PATH },
    { id: "opencodeLog", name: "opencode.log", path: OPENCODE_PATH },
  ],
};

const build = (overrides: Partial<ReportInput>, rt: ReportRuntime = runtime) =>
  buildReportBundle({ ...baseInput, ...overrides }, rt);

/**
 * One activity log with exactly `budget` bytes of room left for it: the
 * screenshot is sized to spend the rest, so the log is measured on its own.
 */
function withRoom(budget: number, source: Pick<ReportLogRequest, "text" | "path">) {
  return {
    screenshotPng: new Uint8Array(LOG_BUDGET_BYTES - budget),
    logs: [{ id: "activityLog", name: ACTIVITY_NAME, ...source }],
  };
}

const entries = (bundle: ReportBundle) => unzipSync(bundle.zip);
const entryText = (bundle: ReportBundle, name: string) => decode(entries(bundle)[name]);

function attachment(bundle: ReportBundle, id: string): AttachmentResult {
  const found = bundle.attachments.find((a) => a.id === id);
  if (!found) throw new Error(`no attachment result for "${id}"`);
  return found;
}

/** The activity log's result and packed text for one log source under `budget`. */
async function packedLog(
  source: Pick<ReportLogRequest, "text" | "path">,
  budget: number,
  rt: ReportRuntime = runtime
) {
  const bundle = await build(withRoom(budget, source), rt);
  const result = attachment(bundle, "activityLog");
  return { result, packed: result.included ? entryText(bundle, ACTIVITY_NAME) : "" };
}

/**
 * Compression method of every central-directory record (signature PK\x01\x02,
 * method at offset 10, little-endian): the upload endpoint rejects the whole
 * bundle over any single compressed entry.
 */
function centralDirectoryMethods(zip: Uint8Array): number[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const methods: number[] = [];
  for (let i = 0; i + 12 <= zip.byteLength; i++) {
    if (view.getUint32(i, true) === 0x02014b50) methods.push(view.getUint16(i + 10, true));
  }
  return methods;
}

/** Reads the issue body back out of an assembled URL. */
const bodyOf = (url: string) => new URLSearchParams(url.split("?")[1]).get("body") ?? "";

describe("issueReport", () => {
  describe("buildReportBundle()", () => {
    it("packs report.md, the screenshot and every requested log into a zip named after the bundle id", async () => {
      const bundle = await build({});

      expect(bundle.zipName).toBe("copilot-report-20260615-101500-abcd.zip");
      expect(Object.keys(entries(bundle)).sort()).toEqual(
        [ACTIVITY_NAME, "opencode.log", "report.md", "screenshot.png"].sort()
      );
      expect(bundle.attachments.map((a) => a.id)).toEqual([
        "report",
        "screenshot",
        "activityLog",
        "opencodeLog",
      ]);
      expect(bundle.attachments.every((a) => a.included)).toBe(true);
    });

    it("reports for each attachment the size of the entry it packed, and 0 for one it left out", async () => {
      const bundle = await build({ screenshotPng: null });

      const packed = entries(bundle);
      const names = ["report.md", "screenshot.png", ACTIVITY_NAME, "opencode.log"];
      expect(bundle.attachments).toHaveLength(names.length);
      bundle.attachments.forEach((a, i) => {
        expect([a.name, a.bytes]).toEqual([names[i], a.included ? packed[a.name].length : 0]);
      });
      expect(attachment(bundle, "screenshot").bytes).toBe(0);
      expect(packed["screenshot.png"]).toBeUndefined();
    });

    it("stores every entry uncompressed, which is the upload endpoint's contract", async () => {
      const methods = centralDirectoryMethods((await build({})).zip);

      expect(methods.length).toBe(4);
      expect(methods.every((m) => m === 0)).toBe(true);
    });

    it("offers for upload exactly the bytes of the zip it returns", async () => {
      // The upload sends the buffer held here, so nothing beyond the zip may
      // ride along in a pooled buffer.
      const bundle = await build({});

      expect(new Uint8Array(bundle.uploadAttempt.body)).toEqual(bundle.zip);
      expect(bundle.uploadAttempt.body.byteLength).toBe(bundle.zip.length);
    });

    it("mints a fresh idempotency key for every bundle, so two bundles are two uploads", async () => {
      const [first, second] = await Promise.all([build({}), build({})]);

      expect(first.uploadAttempt.idempotencyKey).not.toBe(second.uploadAttempt.idempotencyKey);
    });

    it.each([
      ["read from disk", {}, [ACTIVITY_NAME, "opencode.log"]],
      [
        "held in memory",
        { logs: [{ id: "chatLog", name: "chat.md", text: SECRET_LOG }] },
        ["chat.md"],
      ],
    ])("redacts a log %s before packing it", async (_case, overrides, names) => {
      const bundle = await build(overrides);

      for (const name of names) {
        const text = entryText(bundle, name);
        expect(text).toContain("/Users/<user>/vault");
        expect(text).toContain("<secret>");
        expect(text).not.toContain("/Users/alice");
        expect(text).not.toContain("sk-abcdef0123456789");
      }
    });

    it("reads a log's file when a request carries both a path and inline text", async () => {
      const bundle = await build({
        logs: [{ id: "a", name: ACTIVITY_NAME, path: ACTIVITY_PATH, text: "inline must lose" }],
      });

      expect(entryText(bundle, ACTIVITY_NAME)).toContain("log line for");
      expect(entryText(bundle, ACTIVITY_NAME)).not.toContain("inline must lose");
    });

    it.each([
      ["null", null],
      ["an empty buffer", new Uint8Array()],
    ])(
      `leaves the screenshot out with a note when the capture produced %s (${ISSUE_URL})`,
      async (_case, png) => {
        const bundle = await build({ screenshotPng: png });

        expect(attachment(bundle, "screenshot")).toEqual({
          id: "screenshot",
          name: "screenshot.png",
          bytes: 0,
          included: false,
          note: "no screenshot was captured",
        });
        expect(entries(bundle)["screenshot.png"]).toBeUndefined();
      }
    );

    it(`lists no screenshot at all when the source was never offered or selected (${ISSUE_URL})`, async () => {
      const bundle = await build({ screenshotPng: undefined });

      expect(bundle.attachments.map((a) => a.id)).toEqual(["report", "activityLog", "opencodeLog"]);
      expect(entries(bundle)["screenshot.png"]).toBeUndefined();
      expect(entryText(bundle, "report.md")).not.toContain("screenshot");
    });

    it(`leaves an oversized screenshot out rather than failing the whole bundle (${ISSUE_URL})`, async () => {
      // One byte past the room left once report.md's reserve is taken: the
      // reserve comes off before the screenshot is measured, not after.
      const bundle = await build({ screenshotPng: new Uint8Array(LOG_BUDGET_BYTES + 1) });

      expect(attachment(bundle, "screenshot")).toMatchObject({
        included: false,
        note: "screenshot is 23.9 MB, over the 23.9 MB left",
      });
      expect(entries(bundle)["screenshot.png"]).toBeUndefined();
      expect(attachment(bundle, "activityLog").included).toBe(true);
      expect(attachment(bundle, "report").included).toBe(true);
    });

    it(`spends the budget on the screenshot first, then on the logs in request order (${ISSUE_URL})`, async () => {
      // 1 KiB is left after the screenshot: enough for one 600-byte log whole,
      // and too little for a useful tail of the other, so whichever log is
      // measured first is the one that goes in.
      const line = "e\n".repeat(300);
      const bundle = await build({
        screenshotPng: new Uint8Array(LOG_BUDGET_BYTES - 1024),
        logs: [
          { id: "first", name: "first.log", text: line },
          { id: "second", name: "second.log", text: line },
        ],
      });

      expect(attachment(bundle, "screenshot").included).toBe(true);
      expect(attachment(bundle, "first").included).toBe(true);
      // Names both sides, so a log that is itself enormous reads differently
      // from one that merely arrived after the budget was spent.
      expect(attachment(bundle, "second")).toMatchObject({
        included: false,
        note: "log is 600 B, over the 424 B left",
      });
    });

    it(`records a log with neither path nor text as not found, or with the reason its request gives (${ISSUE_URL})`, async () => {
      const bundle = await build({
        logs: [
          { id: "chatLog", name: "chat.md" },
          { id: "opencodeLog", name: "opencode.log", unavailableReason: "No OpenCode log." },
        ],
      });

      expect(attachment(bundle, "chatLog")).toMatchObject({ included: false, note: "not found" });
      expect(attachment(bundle, "opencodeLog")).toMatchObject({
        included: false,
        note: "No OpenCode log.",
      });
    });

    it(`redacts and flattens a request's own unavailable reason before it reaches the note, report.md and the issue body (${ISSUE_URL})`, async () => {
      const unavailableReason = "opencode exited:\n  access_token=abc123secret";
      const bundle = await build({
        logs: [{ id: "opencodeLog", name: "opencode.log", unavailableReason }],
      });

      const note = "opencode exited: access_token=<redacted>";
      expect(attachment(bundle, "opencodeLog").note).toBe(note);
      for (const text of [entryText(bundle, "report.md"), bundle.issueDraft.body]) {
        expect(text).toContain(`- opencode.log — not included: ${note}`);
        expect(text).not.toContain("abc123secret");
      }
    });

    it.each([
      {
        outcome: `not found when its file does not exist yet, as on a fresh install (${ISSUE_URL})`,
        readTail: () =>
          Promise.reject(Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" })),
        note: "not found",
      },
      {
        outcome: `empty when the read returns nothing, instead of a zero-byte entry (${ISSUE_URL})`,
        readTail: async () => ({ text: "", totalBytes: 0 }),
        note: "empty",
      },
      {
        outcome: `failed with the reason when the read rejects (${ISSUE_URL})`,
        readTail: () => Promise.reject(new Error("EIO: rotated away")),
        note: "failed: EIO: rotated away",
      },
      {
        outcome:
          "failed with the reason redacted and flattened, so a failing path cannot name the user",
        readTail: () =>
          Promise.reject(new Error("EACCES: open '/Users/alice/Library/acp.ndjson'\nretry later")),
        // One line, because it lands inside a markdown bullet list.
        note: "failed: EACCES: open '/Users/<user>/Library/acp.ndjson' retry later",
      },
      {
        outcome: "failed with a runaway reason capped, so it cannot eat the report budget",
        readTail: () => Promise.reject(new Error("x".repeat(50_000))),
        note: `failed: ${"x".repeat(1024)}…`,
      },
    ])(
      "records the activity log as $outcome, and still packs the rest",
      async ({ readTail, note }) => {
        const bundle = await build({}, forActivityLog(readTail));

        expect(attachment(bundle, "activityLog")).toMatchObject({
          included: false,
          bytes: 0,
          note,
        });
        expect(entries(bundle)[ACTIVITY_NAME]).toBeUndefined();
        expect(attachment(bundle, "opencodeLog").included).toBe(true);
        expect(entryText(bundle, "report.md")).toContain(note);
        expect(entryText(bundle, "report.md")).not.toContain("/Users/alice");
      }
    );

    it.each([
      {
        behaviour: `keeps only the newest slice of an oversized log and names the original size in its note (${ISSUE_URL})`,
        text: "old entry\n".repeat(10_000) + "the newest entry\n",
        budget: TAILABLE_BUDGET_BYTES,
        note: /^truncated to the newest entries of 97\.7 KB$/,
        contains: ["earlier entries omitted", "the newest entry"],
      },
      {
        // 99,844 bytes: inside the 100,000 budget but within the banner
        // reserve's width of it, so a reserve deducted from every log's budget
        // would shorten this one.
        behaviour:
          "includes a log that fits the budget whole, with no banner and nothing cut off the front",
        text: "the oldest entry\n" + "an entry\n".repeat(11_090) + "the newest entry\n",
        budget: 100_000,
        whole: true,
      },
      {
        // Two-byte lines, so the fragment dropped at the cut is far shorter
        // than the banner that replaces it and cannot absorb its width.
        behaviour: "keeps a banner-ed tail inside the budget it was measured against",
        text: "e\n".repeat(200_000),
        budget: TAILABLE_BUDGET_BYTES,
        note: /^truncated to the newest entries of /,
        contains: ["earlier entries omitted"],
      },
      {
        // Redaction knows a secret by what precedes it, and half of `password=`
        // in front of a value means the value reads as ordinary text. The
        // fragment goes and the log stays: leaving the whole source out would
        // satisfy the negative assertion on its own.
        behaviour: `drops the cut-open first line of a tail rather than redacting a fragment (${ISSUE_URL})`,
        text: "password=hunter2000 and more text to push past the cut\n".repeat(2000),
        budget: TAILABLE_BUDGET_BYTES,
        note: /^truncated to the newest entries of /,
        contains: ["and more text to push past the cut"],
        omits: ["hunter2000"],
      },
      {
        behaviour: "still includes a small log that fits whole in room too small for a tail",
        text: "small log\n",
        budget: 1024,
        whole: true,
      },
      {
        // A 1 MB log against 256 KiB of room: the slice read for the tail grows
        // 7% under redaction. The whole log used to be left out at this point,
        // which is what a real 22 MB OpenCode log met with 21.5 MB of room.
        behaviour: `keeps a tail that redaction grew past the budget, cut to fit after redacting rather than left out (${ISSUE_URL})`,
        text: INFLATING_LINE.repeat(12_700),
        budget: 256 * 1024,
        note: /^truncated to the newest entries of 1\.0 MB$/,
        contains: ["earlier entries omitted", "/Users/<user>/vault", "secret=<redacted>"],
        omits: ["/Users/wy/", "hunter22"],
      },
      {
        // Eight bytes to spare before redaction, six too few after it; the room
        // is over the tail floor, so the log is kept as a tail.
        behaviour: `truncates a log that fit whole before redaction and overflowed after it, instead of leaving it out (${ISSUE_URL})`,
        text: INFLATING_LINE.repeat(1100),
        budget: encode(INFLATING_LINE.repeat(1100)).length + 8,
        note: /^truncated to the newest entries of 89\.2 KB$/,
        contains: ["earlier entries omitted", "/Users/<user>/vault", "secret=<redacted>"],
        omits: ["/Users/wy/", "hunter22"],
      },
      {
        // The cut lands on `password=`, the line redaction needs to recognise
        // the value under it. Cutting first drops that line as the tail's
        // fragment and packs `sensitivevalue` as plain text.
        behaviour: `redacts a credential split across the cut, by redacting the slice before cutting it (${ISSUE_URL})`,
        text: SPLIT_CREDENTIAL_LOG,
        budget: SPLIT_CREDENTIAL_BUDGET,
        note: /^truncated to the newest entries of 162\.1 KB$/,
        contains: ["earlier entries omitted", "password=\n<redacted>"],
        omits: ["sensitivevalue"],
      },
    ])("$behaviour", async ({ text, budget, note, contains = [], omits = [], whole = false }) => {
      const { result, packed } = await packedLog({ text }, budget);

      expect(result.included).toBe(true);
      if (note === undefined) expect(result.note).toBeUndefined();
      else expect(result.note).toMatch(note);
      expect(result.bytes).toBe(encode(packed).length);
      expect(encode(packed).length).toBeLessThanOrEqual(budget);
      for (const part of contains) expect(packed).toContain(part);
      for (const part of omits) expect(packed).not.toContain(part);
      if (whole) expect(packed).toBe(text);
    });

    // Every row hides its value only when the whole log is redacted before any
    // cut: a window opened after the key, however much context it carries,
    // loses the pairing. The expectation is parity with full-text redaction,
    // not a fixed string, so the rows test the order of operations and nothing else.
    const CROSS_CUT_LOGS = [
      {
        shape: "a key on the line before the cut",
        log: SPLIT_CREDENTIAL_LOG,
        budget: SPLIT_CREDENTIAL_BUDGET,
        keeps: "password=\n<redacted>",
      },
      {
        shape: "a key one byte before a window that shrinks under redaction",
        log: SHRINKING_WINDOW_LOG,
        budget: 64 * 1024,
        keeps: "password=\n<redacted>",
      },
      {
        shape: "a key two lines above the cut, with the separator alone on its line",
        log: SEPARATOR_LINE_LOG,
        budget: TAILABLE_BUDGET_BYTES,
        keeps: "password\n:\n<redacted>",
      },
      {
        shape: "a run of bare keys that re-pair from wherever the read starts",
        log: CHAINED_KEYS_LOG,
        budget: TAILABLE_BUDGET_BYTES,
        keeps: "secret=\n<redacted>",
      },
    ];
    const LOG_SOURCES = [
      { held: "in memory", source: (log: string) => ({ text: log }), rt: () => runtime },
      {
        held: "on disk",
        source: () => ({ path: ACTIVITY_PATH }),
        rt: (log: string) => runtimeWith({ [ACTIVITY_PATH]: log }),
      },
    ];
    it.each(CROSS_CUT_LOGS.flatMap((row) => LOG_SOURCES.map((held) => ({ ...row, ...held }))))(
      `treats $shape in a log held $held exactly as redacting the whole log would (${ISSUE_URL})`,
      async ({ log, budget, keeps, source, rt }) => {
        const { result, packed } = await packedLog(source(log), budget, rt(log));

        expect(result.included).toBe(true);
        expect(packed.includes("sensitivevalue")).toBe(
          redactLogText(log).includes("sensitivevalue")
        );
        expect(packed).not.toContain("sensitivevalue");
        expect(packed).toContain(keeps);
      }
    );

    it(`reads a log whole, up to the ceiling, rather than a window around the budget (${ISSUE_URL})`, async () => {
      // Redaction pairs a value with a key that can be any distance ahead of
      // it, so only a read that starts where the file does sees every pair.
      const readTail = jest.fn(runtime.readTail);

      await packedLog({ path: ACTIVITY_PATH }, TAILABLE_BUDGET_BYTES, { readTail });

      expect(readTail).toHaveBeenCalledWith(ACTIVITY_PATH, MAX_REDACTABLE_LOG_BYTES);
    });

    it(`packs a log exactly at the redaction ceiling and leaves one byte over it out (${ISSUE_URL})`, async () => {
      // Sizes are the runtime's word; the text is a stand-in, since the point
      // is where the ceiling sits and not what 64 MiB of log redacts to.
      const sized = (totalBytes: number) => ({
        readTail: async () => ({ text: SECRET_LOG, totalBytes }),
      });

      const atCeiling = await packedLog(
        { path: ACTIVITY_PATH },
        TAILABLE_BUDGET_BYTES,
        sized(MAX_REDACTABLE_LOG_BYTES)
      );
      const overCeiling = await packedLog(
        { path: ACTIVITY_PATH },
        TAILABLE_BUDGET_BYTES,
        sized(MAX_REDACTABLE_LOG_BYTES + 1)
      );

      expect(atCeiling.result.included).toBe(true);
      expect(atCeiling.packed).toContain("<secret>");
      expect(overCeiling.result).toMatchObject({
        included: false,
        bytes: 0,
        note: "log is 64.0 MB, over the 64.0 MB a report can redact",
      });
    });

    it.each([
      {
        behaviour: `a tail with no line break under its cut-open first line (${ISSUE_URL})`,
        source: { text: "x".repeat(300_000) },
        budget: TAILABLE_BUDGET_BYTES,
        note: "newest entry alone is larger than the room left",
      },
      {
        behaviour: `a tail whose only line break is its last byte (${ISSUE_URL})`,
        source: { text: `${"x".repeat(300_000)}\n` },
        budget: TAILABLE_BUDGET_BYTES,
        note: "newest entry alone is larger than the room left",
      },
      {
        behaviour: "an oversized log when the room left is too small for a useful tail",
        source: { text: "e\n".repeat(50_000) },
        budget: 1024,
        note: "log is 97.7 KB, over the 1.0 KB left",
      },
      {
        // Reports a size the budget accepts, then hands back one unbroken line
        // of twice that: the only cut that fits leaves nothing under it.
        behaviour: "a log that outgrew the budget between being measured and being read",
        source: { path: ACTIVITY_PATH },
        budget: TAILABLE_BUDGET_BYTES,
        rt: {
          readTail: async () => ({ text: "x".repeat(2 * TAILABLE_BUDGET_BYTES), totalBytes: 16 }),
        },
        note: "newest entry alone is larger than the room left",
      },
      {
        // Redaction is only as good as the text it sees, so a log too large to
        // read whole is left out rather than redacted in part.
        behaviour: `a log over the size a report can redact whole (${ISSUE_URL})`,
        source: { path: ACTIVITY_PATH },
        budget: TAILABLE_BUDGET_BYTES,
        rt: { readTail: async () => ({ text: SECRET_LOG, totalBytes: 100 * 1024 * 1024 }) },
        note: "log is 100.0 MB, over the 64.0 MB a report can redact",
      },
      {
        // Eight bytes to spare before redaction, 4 KiB over after it, in room
        // under the tail floor: a tail here would be too short to diagnose
        // anything, the same as for a log that was over the budget to begin with.
        behaviour: `a log that fit whole before redaction and overflowed after it, when the room left is under the tail floor (${ISSUE_URL})`,
        source: { text: INFLATING_LINE.repeat(700) },
        budget: encode(INFLATING_LINE.repeat(700)).length + 8,
        note: "log is 60.8 KB, over the 56.7 KB left",
      },
    ])("leaves out $behaviour", async ({ source, budget, rt, note }) => {
      const { result } = await packedLog(source, budget, rt);

      expect(result).toMatchObject({ included: false, bytes: 0, note });
    });

    it(`names the redacted size in the floor note, since that is the size that did not fit (${ISSUE_URL})`, async () => {
      // 83 bytes raw with 84 left reads as a log that fits; the 89 bytes it
      // redacts to is what the budget turned down, and a note quoting the raw
      // size would contradict the room it says the log is over.
      const rawBytes = encode(INFLATING_LINE).length;
      const redactedBytes = encode(redactLogText(INFLATING_LINE)).length;

      const { result } = await packedLog({ text: INFLATING_LINE }, rawBytes + 1);

      expect([rawBytes, redactedBytes]).toEqual([83, 89]);
      expect(result).toMatchObject({
        included: false,
        bytes: 0,
        note: "log is 89 B, over the 84 B left",
      });
    });

    it(`still packs report.md alone when every source is left out, and says so in it (${ISSUE_URL})`, async () => {
      const bundle = await build({
        screenshotPng: null,
        logs: [{ id: "opencodeLog", name: "opencode.log", unavailableReason: "not installed" }],
      });

      expect(Object.keys(entries(bundle))).toEqual(["report.md"]);
      const md = entryText(bundle, "report.md");
      expect(md).toContain("- screenshot.png — not included: no screenshot was captured");
      expect(md).toContain("- opencode.log — not included: not installed");
    });

    it("lists in report.md the same attachments and notes the bundle reports", async () => {
      const room = withRoom(TAILABLE_BUDGET_BYTES, { text: "old\n".repeat(50_000) });
      const bundle = await build(
        { ...room, logs: [...room.logs, { id: "o", name: "opencode.log", path: OPENCODE_PATH }] },
        rejecting(new Error("EACCES"))
      );

      const md = entryText(bundle, "report.md");
      for (const a of bundle.attachments.filter((a) => a.id !== "report")) {
        expect(md).toContain(`- ${a.name}`);
        if (a.note) expect(md).toContain(a.note);
      }
      expect(md).toContain(`- ${ACTIVITY_NAME} — truncated to the newest entries of`);
      expect(md).toContain("- opencode.log — not included: failed: EACCES");
      expect(md).not.toContain("- report.md");
    });

    it("redacts the user's description before it reaches report.md and the issue draft", async () => {
      const note = "crashed while indexing /Users/alice/vault with sk-abcdef0123456789";
      const bundle = await build({ note });

      for (const text of [entryText(bundle, "report.md"), bundle.issueDraft.body]) {
        expect(text).toContain("/Users/<user>/vault");
        expect(text).toContain("<secret>");
        expect(text).not.toContain("/Users/alice");
        expect(text).not.toContain("sk-abcdef0123456789");
      }
      expect(bundle.issueDraft.title).not.toContain("sk-abcdef0123456789");
    });

    it("cuts the issue title from the description's first line and builds the body from report.md", async () => {
      const bundle = await build({ note: `${"t".repeat(100)}\n\nmore detail about the crash` });

      expect(bundle.issueDraft.title).toBe("t".repeat(80));
      expect(bundle.issueDraft.body).toBe(entryText(bundle, "report.md"));
      expect(bundle.issueDraft.body).toContain("more detail about the crash");
      expect(bundle.issueDraft.body).toContain("- Plugin version: 1.2.3");
    });

    it("falls back to a generic title when the user typed no description at all", async () => {
      const bundle = await build({ note: "   " });

      expect(bundle.issueDraft.body).toContain("_No description provided._");
      expect(bundle.issueDraft.title).toBe("Copilot issue report");
    });

    it(`refuses a report.md that overruns the room set aside for it (${ISSUE_URL})`, async () => {
      // The note is at its own cap, so enough failing sources push the
      // attachment list past the headroom left for it.
      const logs = Array.from({ length: 20 }, (_unused, i) => ({
        id: `log${i}`,
        name: `log${i}.txt`,
        path: ACTIVITY_PATH,
      }));

      await expect(
        build({ note: "A".repeat(MAX_NOTE_BYTES), logs }, rejecting(new Error("y".repeat(50_000))))
      ).rejects.toThrow(/report summary came out .* over the .* set aside for it/);
    });

    it("refuses a zip over GitHub's attachment limit and names the largest source the user can drop", async () => {
      jest.mocked(zipSync).mockReturnValueOnce(new Uint8Array(26 * 1024 * 1024));
      const bigger = runtimeWith({
        [ACTIVITY_PATH]: SECRET_LOG.repeat(10),
        [OPENCODE_PATH]: SECRET_LOG,
      });

      const message = await build({}, bigger).then(
        () => "",
        (err: Error) => err.message
      );

      expect(message).toMatch(/attachment limit/);
      expect(message).toContain(ACTIVITY_NAME);
      // A smaller optional source would send them after the wrong one, and
      // `report.md` is advice they cannot take.
      expect(message).not.toContain("opencode.log");
      expect(message).not.toContain("report.md");
    });
  });

  describe("buildManualIssueUrl()", () => {
    it("prefills a bug issue on the public repo with the draft's title and body", () => {
      const url = buildManualIssueUrl({ title: "it exploded", body: "## What went wrong\n\nboom" });

      const params = new URLSearchParams(url.split("?")[1]);
      expect(url.startsWith("https://github.com/logancyang/obsidian-copilot/issues/new?")).toBe(
        true
      );
      expect(params.get("title")).toBe("it exploded");
      expect(params.get("labels")).toBe("bug");
      expect(bodyOf(url)).toBe("## What went wrong\n\nboom");
      expect(url).not.toContain("truncated");
    });

    it("truncates the body so the URL stays inside what a browser will open", () => {
      // Windows caps what `openExternal` accepts, so a long description loses
      // its tail rather than the whole link failing to open.
      const url = buildManualIssueUrl({ title: "long", body: "n".repeat(8000) });

      expect(url.length).toBeLessThanOrEqual(1800);
      expect(bodyOf(url)).toContain("report truncated");
    });
  });

  describe("buildLinkedReportIssueUrl()", () => {
    const REPORT_ID = "9f3c1a7b2e4d5f60819a2b3c4d5e6f70";

    it("opens the issue body with the report ID and labels the issue a bug", () => {
      const url = buildLinkedReportIssueUrl({ title: "it exploded", body: "## What" }, REPORT_ID);

      const params = new URLSearchParams(url.split("?")[1]);
      expect(url.startsWith("https://github.com/logancyang/obsidian-copilot/issues/new?")).toBe(
        true
      );
      expect(params.get("title")).toBe("it exploded");
      expect(params.get("labels")).toBe("bug");
      expect(bodyOf(url)).toBe(`**Copilot report ID:** \`${REPORT_ID}\`\n\n## What`);
    });

    it("names the bundle by ID and never by a URL that would fetch it", () => {
      // The issue is public: a link that pulled the bundle down would hand the
      // reporter's screenshot and logs to everyone reading the thread.
      const url = buildLinkedReportIssueUrl({ title: "leaky", body: "see attached" }, REPORT_ID);

      expect(bodyOf(url)).not.toContain("http");
    });

    it("keeps the report ID when a long description has to be cut short", () => {
      // The ID exists only in the upload response, so losing it to truncation
      // would leave an uploaded bundle nobody can match to the issue.
      const url = buildLinkedReportIssueUrl({ title: "long", body: "x".repeat(50_000) }, REPORT_ID);

      expect(bodyOf(url)).toContain(REPORT_ID);
      expect(bodyOf(url)).toContain("report truncated");
      expect(url.length).toBeLessThanOrEqual(1800);
    });
  });

  describe("buildReportMarkdown()", () => {
    const included = (id: string, name: string, note?: string): AttachmentResult => ({
      id,
      name,
      bytes: 10,
      included: true,
      note,
    });

    it("includes the note, environment, and attachment list, and never lists report.md itself", () => {
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
      expect(md).not.toContain("- report.md");
    });

    it("carries an attachment's note next to its name, marking the ones left out", () => {
      // `report.md` is what a maintainer reads inside the zip: without the
      // marks, a shortened log reads as whole and a missing one as forgotten.
      const md = buildReportMarkdown(baseInput, [
        included("activityLog", ACTIVITY_NAME, "truncated to the newest entries of 40.0 MB"),
        { id: "opencodeLog", name: "opencode.log", bytes: 0, included: false, note: "empty" },
      ]);

      expect(md).toContain(`- ${ACTIVITY_NAME} — truncated to the newest entries of 40.0 MB`);
      expect(md).toContain("- opencode.log — not included: empty");
    });

    it("falls back to placeholders when the note is empty and nothing was captured", () => {
      const md = buildReportMarkdown({ ...baseInput, note: "   " }, []);

      expect(md).toContain("_No description provided._");
      expect(md).toContain("(none captured)");
    });

    it.each([
      ["keeps the opening of an oversized note and says so", "A".repeat(MAX_NOTE_BYTES * 2), true],
      ["leaves a short description unmarked", "It hung.", false],
      // Each character is 3 UTF-8 bytes, so a cut at the byte cap lands mid-character.
      ["cuts an oversized note on a character boundary", "行".repeat(MAX_NOTE_BYTES), true],
    ])("%s instead of failing or halving a character", (_case, note, truncated) => {
      const md = buildReportMarkdown({ ...baseInput, note }, []);

      expect(md).toContain(note.slice(0, 1000));
      expect(md.includes("description truncated")).toBe(truncated);
      expect(md).not.toContain("�");
      expect(encode(md).length).toBeLessThan(MAX_NOTE_BYTES + 2048);
    });
  });

  describe("getNodeReportRuntime()", () => {
    let dir = "";

    beforeEach(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-report-test-"));
    });

    afterEach(async () => {
      await fs.rm(dir, { recursive: true, force: true });
    });

    it("reads the newest bytes of a real file and reports its full size", async () => {
      const file = path.join(dir, "activity.log");
      await fs.writeFile(file, "hello world");

      await expect(getNodeReportRuntime().readTail(file, 5)).resolves.toEqual({
        text: "world",
        totalBytes: 11,
      });
    });

    it("rejects when the file cannot be opened", async () => {
      const missing = path.join(dir, "missing.log");

      await expect(getNodeReportRuntime().readTail(missing, 5)).rejects.toThrow(/ENOENT/);
    });
  });
});

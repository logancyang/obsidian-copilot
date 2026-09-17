import type { AgentDailyNoteInput } from "@/agents/agentMemory";
import type { AgentFileManager } from "@/agents/AgentFileManager";
import { AGENT_MEMORY_HEADINGS } from "@/agents/agentFile";
import type { CustomAgent } from "@/agents/types";
import {
  hasUnconsolidatedNotes,
  readNotesAfter,
  runAgentMemoryConsolidation,
} from "@/agentMode/session/agentMemoryConsolidation";
import type { ReadOnlySubSessionRunner } from "@/agentMode/session/readOnlySubSession";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const JENNIFER: CustomAgent = {
  slug: "jennifer",
  name: "Jennifer",
  description: "Skeptical editor.",
  icon: "🪶",
  backendId: null,
  modelId: null,
  effort: null,
  memoryEnabled: true,
  created: "2026-09-16T10:00:00Z",
  instructions: "You are Jennifer.",
};

/** A well-formed memory body: the title, the four headings, one entry each. */
function memoryBody(entry = "- (2026-09-10) Writes a weekly newsletter. [[memory/2026-09-10]]") {
  return [
    "# Jennifer's memory",
    "",
    ...AGENT_MEMORY_HEADINGS.flatMap((heading) => [`## ${heading}`, entry, ""]),
  ].join("\n");
}

interface Harness {
  files: AgentFileManager;
  subSessions: ReadOnlySubSessionRunner;
  writes: { body: string; consolidatedThrough: string; expectedHash: string | null }[];
  prompts: string[];
  backends: string[];
}

function buildHarness(
  options: {
    agent?: CustomAgent | null;
    stored?: { body: string; consolidatedThrough: string | null; hash: string } | null;
    notes?: AgentDailyNoteInput[];
    answer?: string;
    write?: "written" | "conflict";
    fail?: Error;
    outcome?: "done" | "aborted";
  } = {}
): Harness {
  const writes: Harness["writes"] = [];
  const prompts: string[] = [];
  const backends: string[] = [];
  const agent = options.agent === undefined ? JENNIFER : options.agent;
  const stored =
    options.stored === undefined
      ? { body: memoryBody(), consolidatedThrough: "2026-09-15", hash: "hash-1" }
      : options.stored;
  const notes = options.notes ?? [{ date: "2026-09-17", text: "- Renamed to Grid Notes." }];

  const files = {
    readAgent: jest.fn(async () =>
      agent
        ? {
            agent,
            folderPath: `copilot/agents/${agent.slug}`,
            filePath: `copilot/agents/${agent.slug}/agent.md`,
            memoryPath: `copilot/agents/${agent.slug}/MEMORY.md`,
            memoryFolderPath: `copilot/agents/${agent.slug}/memory`,
            memoryBytes: 10,
          }
        : null
    ),
    readMemoryDocument: jest.fn(async () =>
      stored ? { text: stored.body, modifiedAtMs: 0, ...stored } : null
    ),
    readDailyNotesAfter: jest.fn(async () => notes),
    readDailyNote: jest.fn(async () => null),
    writeConsolidatedMemory: jest.fn(
      async (
        _slug: string,
        body: string,
        consolidatedThrough: string,
        expectedHash: string | null
      ) => {
        writes.push({ body, consolidatedThrough, expectedHash });
        return options.write ?? "written";
      }
    ),
  } as unknown as AgentFileManager;

  const subSessions = {
    run: jest.fn(
      async (request: {
        backendId: string;
        prompt: { text: string }[];
        onText: (text: string) => void;
      }) => {
        backends.push(request.backendId);
        prompts.push(request.prompt[0].text);
        if (options.fail) throw options.fail;
        request.onText(
          options.answer ?? memoryBody("- (2026-09-17) Grid Notes Weekly. [[memory/2026-09-17]]")
        );
        return options.outcome ?? "done";
      }
    ),
  } as unknown as ReadOnlySubSessionRunner;

  return { files, subSessions, writes, prompts, backends };
}

function run(harness: Harness) {
  return runAgentMemoryConsolidation(
    { files: harness.files, subSessions: harness.subSessions },
    {
      agentSlug: "jennifer",
      sessionBackendId: "claude",
      signal: new AbortController().signal,
      now: new Date(2026, 8, 17),
    }
  );
}

describe("agentMemoryConsolidation", () => {
  describe("runAgentMemoryConsolidation()", () => {
    it("rewrites MEMORY.md and advances the marker to the newest note folded in", async () => {
      const harness = buildHarness();

      const outcome = await run(harness);

      expect(outcome).toEqual({
        status: "written",
        agentName: "Jennifer",
        memoryPath: "copilot/agents/jennifer/MEMORY.md",
        consolidatedThrough: "2026-09-17",
      });
      expect(harness.writes[0].body).toContain("Grid Notes Weekly.");
      expect(harness.writes[0].consolidatedThrough).toBe("2026-09-17");
    });

    it("reads only the days newer than the marker already on the file", async () => {
      const harness = buildHarness();

      await run(harness);

      expect(harness.files.readDailyNotesAfter).toHaveBeenCalledWith("jennifer", "2026-09-15");
    });

    it("reads MEMORY.md from disk at pass time, so a user's own edit is the baseline (CUSTOM_AGENTS.md §5)", async () => {
      const harness = buildHarness({
        stored: {
          body: memoryBody("- (2026-09-16) Edited by hand."),
          consolidatedThrough: null,
          hash: "hash-1",
        },
      });

      await run(harness);

      expect(harness.prompts[0]).toContain("Edited by hand.");
      expect(harness.files.readDailyNotesAfter).toHaveBeenCalledWith("jennifer", null);
    });

    it("runs on the agent's pinned backend when it has one", async () => {
      const harness = buildHarness({ agent: { ...JENNIFER, backendId: "codex" } });

      await run(harness);

      expect(harness.backends).toEqual(["codex"]);
    });

    it("skips an agent that has been deleted (CUSTOM_AGENTS.md §1)", async () => {
      const harness = buildHarness({ agent: null });

      expect(await run(harness)).toEqual({ status: "skipped", reason: "no-agent" });
      expect(harness.subSessions.run).not.toHaveBeenCalled();
    });

    it("skips an agent whose memory toggle is off, reading nothing (CUSTOM_AGENTS.md §7)", async () => {
      const harness = buildHarness({ agent: { ...JENNIFER, memoryEnabled: false } });

      expect(await run(harness)).toEqual({ status: "skipped", reason: "memory-off" });
      expect(harness.files.readMemoryDocument).not.toHaveBeenCalled();
    });

    it("skips an agent with no note newer than its marker", async () => {
      const harness = buildHarness({ notes: [] });

      expect(await run(harness)).toEqual({ status: "skipped", reason: "no-new-notes" });
      expect(harness.subSessions.run).not.toHaveBeenCalled();
    });

    it("starts from the empty skeleton when the memory file was deleted by hand", async () => {
      const harness = buildHarness({ stored: null });

      await run(harness);

      expect(harness.prompts[0]).toContain("# Jennifer's memory");
      expect(harness.writes[0].expectedHash).toBeNull();
    });

    it("keeps the old file when the answer fails the safety rails (CUSTOM_AGENTS.md §5)", async () => {
      const harness = buildHarness({ answer: "  " });

      expect(await run(harness)).toEqual({ status: "rejected", reason: "empty" });
      expect(harness.writes).toHaveLength(0);
    });

    it("keeps the old file when the answer dropped one of the fixed headings", async () => {
      const harness = buildHarness({
        answer: memoryBody().replace("## Ongoing threads", "## Loose ends"),
      });

      expect(await run(harness)).toEqual({ status: "rejected", reason: "missing-headings" });
      expect(harness.writes).toHaveLength(0);
    });

    // designdocs/CUSTOM_AGENTS.md §5: the hash is captured with the input and
    // re-checked at the write, so the user's edits are the new baseline.
    it("re-checks the hash it was handed and reports a file edited meanwhile", async () => {
      const harness = buildHarness({ write: "conflict" });

      expect(await run(harness)).toEqual({ status: "conflict" });
      expect(harness.writes[0].expectedHash).toBe("hash-1");
    });

    it("reports a backend failure as an outcome rather than throwing at the trigger", async () => {
      const harness = buildHarness({ fail: new Error("backend down") });

      expect(await run(harness)).toMatchObject({ status: "failed" });
      expect(harness.writes).toHaveLength(0);
    });

    it("writes nothing when the sub-session was aborted mid-answer", async () => {
      const harness = buildHarness({ outcome: "aborted" });

      expect(await run(harness)).toMatchObject({ status: "failed" });
      expect(harness.writes).toHaveLength(0);
    });
  });

  describe("readNotesAfter()", () => {
    it("reads every day when the agent has never consolidated", () => {
      expect(readNotesAfter(null, "2026-09-17")).toBeNull();
    });

    it("reads forward from the marker while it is behind today", () => {
      expect(readNotesAfter("2026-09-15", "2026-09-17")).toBe("2026-09-15");
    });

    it("steps back a day once the marker has reached today, since today is unfinished", () => {
      expect(readNotesAfter("2026-09-17", "2026-09-17")).toBe("2026-09-16");
    });

    it("steps the calendar across a month boundary rather than subtracting hours", () => {
      expect(readNotesAfter("2026-09-01", "2026-09-01")).toBe("2026-08-31");
    });
  });

  describe("hasUnconsolidatedNotes()", () => {
    function files(
      dates: string[],
      consolidatedThrough: string | null,
      mtimes: { memory?: number; note?: number } = {}
    ): AgentFileManager {
      return {
        listDailyNoteDates: () => dates,
        readMemoryDocument: async () => ({
          consolidatedThrough,
          modifiedAtMs: mtimes.memory ?? 2000,
        }),
        readDailyNote: async () => ({ modifiedAtMs: mtimes.note ?? 1000 }),
      } as unknown as AgentFileManager;
    }

    it("is true when a note is newer than the marker", async () => {
      expect(await hasUnconsolidatedNotes(files(["2026-09-17"], "2026-09-16"), "jennifer")).toBe(
        true
      );
    });

    it("is true when the agent has notes and has never consolidated", async () => {
      expect(await hasUnconsolidatedNotes(files(["2026-09-17"], null), "jennifer")).toBe(true);
    });

    it("is false when every note is older than the core that folded it in", async () => {
      expect(await hasUnconsolidatedNotes(files(["2026-09-17"], "2026-09-17"), "jennifer")).toBe(
        false
      );
    });

    // Otherwise a second conversation on an already-consolidated day would
    // never reach MEMORY.md (`designdocs/CUSTOM_AGENTS.md` §5).
    it("is true when today's note was appended to after the core was written", async () => {
      const appendedSince = files(["2026-09-17"], "2026-09-17", { memory: 1000, note: 2000 });

      expect(await hasUnconsolidatedNotes(appendedSince, "jennifer")).toBe(true);
    });

    it("is false for an agent that has never written a note", async () => {
      expect(await hasUnconsolidatedNotes(files([], null), "jennifer")).toBe(false);
    });
  });
});

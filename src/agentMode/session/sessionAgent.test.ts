import type { AgentFileManager, AgentMemoryRead, DailyNoteRead } from "@/agents/AgentFileManager";
import type { CustomAgent } from "@/agents/types";
import {
  COPILOT_SESSION_AGENT,
  loadAgentMemoryInjection,
  loadSessionAgent,
  missingSessionAgent,
} from "@/agentMode/session/sessionAgent";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const MEMORY_MODIFIED_MS = new Date(2026, 8, 14, 15, 0, 0).getTime();
const NOTE_MODIFIED_MS = new Date(2026, 8, 17, 9, 40, 0).getTime();
/** The clock every read is taken against, so the index window is fixed. */
const NOW = new Date(2026, 8, 17, 10, 0, 0);

function jennifer(overrides: Partial<CustomAgent> = {}): CustomAgent {
  return {
    slug: "jennifer",
    name: "Jennifer",
    description: "Skeptical editor.",
    icon: "🪶",
    backendId: null,
    modelId: null,
    effort: null,
    memoryEnabled: true,
    created: "2026-09-16T10:00:00Z",
    instructions: "You are Jennifer, a developmental editor.",
    ...overrides,
  };
}

const CORE: AgentMemoryRead = {
  text: "## About the user\n\n- Writes a climate newsletter.",
  body: "## About the user\n\n- Writes a climate newsletter.",
  consolidatedThrough: "2026-09-16",
  modifiedAtMs: MEMORY_MODIFIED_MS,
  hash: "core-hash",
};

function note(date: string, text: string, modifiedAtMs = NOTE_MODIFIED_MS): DailyNoteRead {
  return { date, path: `copilot/agents/jennifer/memory/${date}.md`, text, modifiedAtMs };
}

/** One day holding one conversation, written the way a flush writes it. */
function dayWith(date: string, time: string, title: string, summary: string): DailyNoteRead {
  return note(date, `# ${date}\n\n## ${time} ${title}\n\n- ${summary}\n`);
}

interface Stubs {
  files: AgentFileManager;
  readMemoryDocument: jest.Mock;
  readDailyNotesAfter: jest.Mock;
}

function buildFiles(
  overrides: {
    readMemoryDocument?: jest.Mock;
    readDailyNotesAfter?: jest.Mock;
  } = {}
): Stubs {
  const readMemoryDocument = overrides.readMemoryDocument ?? jest.fn(async () => CORE);
  const readDailyNotesAfter = overrides.readDailyNotesAfter ?? jest.fn(async () => []);
  return {
    files: {
      readMemoryDocument,
      readDailyNotesAfter,
      getDailyNotePath: (slug: string, date: string) => `copilot/agents/${slug}/memory/${date}.md`,
      getMemoryFolderPath: (slug: string) => `copilot/agents/${slug}/memory`,
    } as unknown as AgentFileManager,
    readMemoryDocument,
    readDailyNotesAfter,
  };
}

describe("sessionAgent", () => {
  describe("loadAgentMemoryInjection()", () => {
    // designdocs/CUSTOM_AGENTS.md §5: the block carries MEMORY.md plus an index
    // of the conversations the recent daily notes record, not the notes.
    it("carries the curated core and an index line per recent conversation", async () => {
      const { files } = buildFiles({
        readDailyNotesAfter: jest.fn(async () => [
          dayWith("2026-09-16", "11:00", "Pitch list", "Ranked the six pitches."),
          dayWith("2026-09-17", "09:40", "Grid Notes intro", "Cut the intro to one paragraph."),
        ]),
      });

      const memory = await loadAgentMemoryInjection(files, jennifer(), NOW);

      expect(memory?.block).toContain("## Your consolidated summary");
      expect(memory?.block).toContain("Writes a climate newsletter.");
      expect(memory?.block).toContain("## Your recent conversations");
      expect(memory?.block).toContain(
        "- 2026-09-17 09:40 Grid Notes intro · Cut the intro to one paragraph. [[memory/2026-09-17]]"
      );
      expect(memory?.block).toContain(
        "- 2026-09-16 11:00 Pitch list · Ranked the six pitches. [[memory/2026-09-16]]"
      );
    });

    it("leaves the bullets a note holds beyond the first on disk", async () => {
      const { files } = buildFiles({
        readDailyNotesAfter: jest.fn(async () => [
          note(
            "2026-09-17",
            "# 2026-09-17\n\n## 09:40 Grid Notes intro\n\n- Cut the intro.\n- The user has two cats.\n"
          ),
        ]),
      });

      const memory = await loadAgentMemoryInjection(files, jennifer(), NOW);

      expect(memory?.block).toContain("Cut the intro.");
      expect(memory?.block).not.toContain("two cats");
    });

    it("reads only the daily notes inside the fourteen-day window", async () => {
      const { files, readDailyNotesAfter } = buildFiles();

      await loadAgentMemoryInjection(files, jennifer(), NOW);

      expect(readDailyNotesAfter).toHaveBeenCalledWith("jennifer", "2026-09-03");
    });

    it("gives the same files the same fingerprint and a changed note inside the window a new one", async () => {
      const inWindow = dayWith("2026-09-17", "09:40", "Grid Notes intro", "Cut the intro.");
      const { files } = buildFiles({ readDailyNotesAfter: jest.fn(async () => [inWindow]) });
      const first = await loadAgentMemoryInjection(files, jennifer(), NOW);
      const again = await loadAgentMemoryInjection(files, jennifer(), NOW);

      expect(again?.fingerprint).toBe(first?.fingerprint);

      // A flush in another tab appends a heading to the same day, which is what
      // has to reach the next turn in this one.
      const flushed = buildFiles({
        readDailyNotesAfter: jest.fn(async () => [
          note(
            inWindow.date,
            `${inWindow.text}\n## 11:00 Pitch list\n\n- Ranked the six pitches.\n`
          ),
        ]),
      });

      expect(
        (await loadAgentMemoryInjection(flushed.files, jennifer(), NOW))?.fingerprint
      ).not.toBe(first?.fingerprint);
    });

    it("keeps the fingerprint when a day outside the window changes, which it never reads", async () => {
      // The window is enforced by the read, so an older day cannot reach the
      // block at all — the same read returns the same index.
      const readDailyNotesAfter = jest.fn(async (_slug: string, after: string) =>
        after === "2026-09-03"
          ? [dayWith("2026-09-17", "09:40", "Grid Notes intro", "Cut the intro.")]
          : []
      );
      const { files } = buildFiles({ readDailyNotesAfter });

      const first = await loadAgentMemoryInjection(files, jennifer(), NOW);
      const again = await loadAgentMemoryInjection(files, jennifer(), NOW);

      expect(again?.fingerprint).toBe(first?.fingerprint);
      expect(readDailyNotesAfter.mock.calls.map((call) => call[1])).toEqual([
        "2026-09-03",
        "2026-09-03",
      ]);
    });

    it("gives an edited MEMORY.md a new fingerprint", async () => {
      const { files } = buildFiles();
      const first = await loadAgentMemoryInjection(files, jennifer(), NOW);

      const edited = buildFiles({
        readMemoryDocument: jest.fn(async () => ({ ...CORE, body: "## About the user\n\n- New." })),
      });

      expect((await loadAgentMemoryInjection(edited.files, jennifer(), NOW))?.fingerprint).not.toBe(
        first?.fingerprint
      );
    });

    it("never reads a file when the agent's memory toggle is off", async () => {
      const { files, readMemoryDocument, readDailyNotesAfter } = buildFiles();

      expect(
        await loadAgentMemoryInjection(files, jennifer({ memoryEnabled: false }), NOW)
      ).toBeNull();
      expect(readMemoryDocument).not.toHaveBeenCalled();
      expect(readDailyNotesAfter).not.toHaveBeenCalled();
    });

    it("carries the index alone for an agent whose MEMORY.md is missing", async () => {
      const { files } = buildFiles({
        readMemoryDocument: jest.fn(async () => null),
        readDailyNotesAfter: jest.fn(async () => [
          dayWith("2026-09-17", "09:40", "Grid Notes intro", "Cut the intro."),
        ]),
      });

      const memory = await loadAgentMemoryInjection(files, jennifer(), NOW);

      expect(memory?.block).toContain("Grid Notes intro");
      expect(memory?.block).not.toContain("Your consolidated summary");
    });

    it("carries a legacy MEMORY.md that has no frontmatter, which is every pre-consolidation file", async () => {
      const { files } = buildFiles({
        readMemoryDocument: jest.fn(async () => ({
          ...CORE,
          consolidatedThrough: null,
          body: "## About the user\n\n- Writes a climate newsletter.",
        })),
      });

      expect((await loadAgentMemoryInjection(files, jennifer(), NOW))?.block).toContain(
        "Writes a climate newsletter."
      );
    });

    it("reports nothing when the agent has neither a core nor any recent conversation", async () => {
      const { files } = buildFiles({ readMemoryDocument: jest.fn(async () => null) });

      expect(await loadAgentMemoryInjection(files, jennifer(), NOW)).toBeNull();
    });

    it("reports nothing rather than throwing when a memory file cannot be read", async () => {
      // An unreadable notebook is not a reason to refuse the conversation; the
      // agent answers in character with nothing recalled.
      const { files } = buildFiles({
        readMemoryDocument: jest.fn(async () => {
          throw new Error("EACCES");
        }),
      });

      expect(await loadAgentMemoryInjection(files, jennifer(), NOW)).toBeNull();
    });
  });

  describe("loadSessionAgent()", () => {
    it("carries the agent's display fields, its persona block, and what it knows", async () => {
      const { files } = buildFiles();

      const agent = await loadSessionAgent(files, jennifer());

      expect(agent).toMatchObject({ slug: "jennifer", name: "Jennifer", icon: "🪶" });
      expect(agent.personaBlock).toContain('<agent_persona name="Jennifer">');
      expect(agent.memory?.block).toContain('<agent_memory name="Jennifer"');
      expect(agent.memory?.block).toContain("Writes a climate newsletter.");
    });

    // designdocs/CUSTOM_AGENTS.md §5: the persona block names today's note so
    // the agent appends to it with its own file tools during a turn.
    it("tells a writable chat's agent where to keep its notes", async () => {
      const { files } = buildFiles();

      const agent = await loadSessionAgent(files, jennifer());

      expect(agent.personaBlock).toContain("copilot/agents/jennifer/memory/");
      expect(agent.personaBlock).toContain("open a day's file when a question reaches past");
      expect(agent.personaBlock).toContain("Never edit your MEMORY.md.");
    });

    it("says nothing about notes for a read-only fan-out answerer", async () => {
      const { files } = buildFiles();

      const agent = await loadSessionAgent(files, jennifer(), { writable: false });

      expect(agent.personaBlock).not.toContain("Keeping your own notes");
      expect(agent.memory?.block).toContain("Writes a climate newsletter.");
    });

    it("carries no memory and no note-keeping when the agent's memory toggle is off", async () => {
      const { files, readMemoryDocument } = buildFiles();

      const agent = await loadSessionAgent(files, jennifer({ memoryEnabled: false }));

      expect(readMemoryDocument).not.toHaveBeenCalled();
      expect(agent.memory).toBeNull();
      expect(agent.personaBlock).not.toContain("Keeping your own notes");
    });
  });

  describe("missingSessionAgent()", () => {
    it("keeps the deleted agent's name as a label and sends no persona", () => {
      // `designdocs/CUSTOM_AGENTS.md` §1: the chat opens, shows who it was held
      // with, and runs as the default assistant.
      expect(missingSessionAgent("night-editor")).toEqual({
        slug: "night-editor",
        name: "Night Editor",
        icon: "",
        personaBlock: null,
        memory: null,
      });
    });
  });

  describe("COPILOT_SESSION_AGENT", () => {
    it("names no agent and carries no persona or memory, which is today's assistant", () => {
      expect(COPILOT_SESSION_AGENT.slug).toBeNull();
      expect(COPILOT_SESSION_AGENT.name).toBe("Copilot");
      expect(COPILOT_SESSION_AGENT.personaBlock).toBeNull();
      expect(COPILOT_SESSION_AGENT.memory).toBeNull();
    });
  });
});

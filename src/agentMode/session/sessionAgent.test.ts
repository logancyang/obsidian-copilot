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
/** The clock every read is taken against, so "today" and "yesterday" are fixed. */
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

function note(date: string, text: string): DailyNoteRead {
  return {
    date,
    path: `copilot/agents/jennifer/memory/${date}.md`,
    text,
    modifiedAtMs: NOTE_MODIFIED_MS,
  };
}

interface Stubs {
  files: AgentFileManager;
  readMemoryDocument: jest.Mock;
  readDailyNote: jest.Mock;
}

function buildFiles(
  overrides: {
    readMemoryDocument?: jest.Mock;
    readDailyNote?: jest.Mock;
  } = {}
): Stubs {
  const readMemoryDocument = overrides.readMemoryDocument ?? jest.fn(async () => CORE);
  const readDailyNote = overrides.readDailyNote ?? jest.fn(async () => null);
  return {
    files: {
      readMemoryDocument,
      readDailyNote,
      getDailyNotePath: (slug: string, date: string) => `copilot/agents/${slug}/memory/${date}.md`,
      getMemoryFolderPath: (slug: string) => `copilot/agents/${slug}/memory`,
    } as unknown as AgentFileManager,
    readMemoryDocument,
    readDailyNote,
  };
}

describe("sessionAgent", () => {
  describe("loadAgentMemoryInjection()", () => {
    // designdocs/CUSTOM_AGENTS.md §5: the block carries MEMORY.md plus today's
    // and yesterday's notes, each labeled.
    it("carries the curated core and the two most recent days, labeled", async () => {
      const { files, readDailyNote } = buildFiles({
        readDailyNote: jest.fn(async (_slug: string, date: string) =>
          date === "2026-09-17" ? note(date, "- Renamed the newsletter.") : note(date, "- Older.")
        ),
      });

      const memory = await loadAgentMemoryInjection(files, jennifer(), NOW);

      expect(readDailyNote.mock.calls.map((call) => call[1])).toEqual(["2026-09-16", "2026-09-17"]);
      expect(memory?.block).toContain("## MEMORY.md");
      expect(memory?.block).toContain("Writes a climate newsletter.");
      expect(memory?.block).toContain("## Your notes from 2026-09-16");
      expect(memory?.block).toContain("## Your notes from 2026-09-17");
    });

    it("gives the same files the same fingerprint and a changed file a new one", async () => {
      const { files } = buildFiles();
      const first = await loadAgentMemoryInjection(files, jennifer(), NOW);
      const again = await loadAgentMemoryInjection(files, jennifer(), NOW);

      expect(again?.fingerprint).toBe(first?.fingerprint);

      const edited = buildFiles({
        readMemoryDocument: jest.fn(async () => ({ ...CORE, body: "## About the user\n\n- New." })),
      });
      const changed = await loadAgentMemoryInjection(edited.files, jennifer(), NOW);

      expect(changed?.fingerprint).not.toBe(first?.fingerprint);
    });

    it("steps the calendar back a day rather than subtracting hours", async () => {
      const { readDailyNote, files } = buildFiles();

      await loadAgentMemoryInjection(files, jennifer(), new Date(2026, 8, 1, 10, 0, 0));

      expect(readDailyNote.mock.calls.map((call) => call[1])).toEqual(["2026-08-31", "2026-09-01"]);
    });

    it("never reads a file when the agent's memory toggle is off", async () => {
      const { files, readMemoryDocument, readDailyNote } = buildFiles();

      expect(
        await loadAgentMemoryInjection(files, jennifer({ memoryEnabled: false }), NOW)
      ).toBeNull();
      expect(readMemoryDocument).not.toHaveBeenCalled();
      expect(readDailyNote).not.toHaveBeenCalled();
    });

    it("reports nothing when the agent has neither a core nor any recent notes", async () => {
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

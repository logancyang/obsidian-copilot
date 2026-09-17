import { AGENT_MEMORY_HEADINGS, buildAgentMemorySkeleton } from "@/agents/agentFile";
import {
  AGENT_MEMORY_MAX_CHARS,
  previousMemoryDay,
  boundConsolidationNotes,
  buildAgentMemoryConsolidationPrompt,
  buildAgentMemoryFlushPrompt,
  formatMemoryEntryDate,
  parseMemoryFlushBullets,
  reviewMemoryUpdate,
} from "@/agents/agentMemory";

/** A well-formed memory file: the title, the four headings, one entry each. */
function memoryFile(entry = "- (2026-09-10) Writes a weekly newsletter."): string {
  return [
    "# Jennifer's memory",
    "",
    ...AGENT_MEMORY_HEADINGS.flatMap((heading) => [`## ${heading}`, entry, ""]),
  ].join("\n");
}

describe("agentMemory", () => {
  describe("formatMemoryEntryDate()", () => {
    it("renders a local date as YYYY-MM-DD with zero padding", () => {
      expect(formatMemoryEntryDate(new Date(2026, 8, 3))).toBe("2026-09-03");
    });
  });

  describe("previousMemoryDay()", () => {
    it("steps back one calendar day", () => {
      expect(previousMemoryDay("2026-09-17")).toBe("2026-09-16");
    });

    it("steps across a month and a year boundary rather than subtracting hours", () => {
      expect(previousMemoryDay("2026-09-01")).toBe("2026-08-31");
      expect(previousMemoryDay("2026-01-01")).toBe("2025-12-31");
    });
  });

  describe("buildAgentMemoryFlushPrompt()", () => {
    const source = {
      agentName: "Jennifer",
      transcript: "<conversation_history>cut the hydrogen section</conversation_history>",
    };

    it("addresses the agent by name and carries the turns it is to read", () => {
      const prompt = buildAgentMemoryFlushPrompt(source);

      expect(prompt).toContain("You are Jennifer.");
      expect(prompt).toContain("cut the hydrogen section");
    });

    it("asks for standalone bullets rather than a file, since the note is shared (CUSTOM_AGENTS.md §5)", () => {
      const prompt = buildAgentMemoryFlushPrompt(source);

      expect(prompt).toContain("one bullet per thing worth keeping");
      expect(prompt).toContain("Never retell the conversation turn by turn.");
      expect(prompt).toContain("Reply with the bullets and nothing else");
      expect(prompt).not.toContain("complete new contents");
    });

    it("always asks for one bullet saying what the conversation was about, so a later chat can say what was discussed today (CUSTOM_AGENTS.md §5)", () => {
      const prompt = buildAgentMemoryFlushPrompt(source);

      expect(prompt).toContain("one bullet saying what this conversation was about");
      expect(prompt).toContain("Every conversation gets this bullet");
    });

    it("reserves the nothing word for a conversation with no substance, such as a greeting or a test message", () => {
      const prompt = buildAgentMemoryFlushPrompt(source);

      expect(prompt).toContain("Only when the user said nothing of substance");
      expect(prompt).toContain("the single word NOTHING");
    });

    it("falls back to a neutral subject when the agent has no readable name", () => {
      expect(buildAgentMemoryFlushPrompt({ ...source, agentName: "  " })).toContain(
        "You are this agent."
      );
    });
  });

  describe("parseMemoryFlushBullets()", () => {
    it("strips the list markers, leaving one line per thing learned", () => {
      expect(parseMemoryFlushBullets("- Renamed the newsletter.\n* Publishes Wednesdays.")).toEqual(
        ["Renamed the newsletter.", "Publishes Wednesdays."]
      );
    });

    it("keeps prose the model returned without markers, since the line is what matters", () => {
      expect(parseMemoryFlushBullets("Renamed the newsletter.")).toEqual([
        "Renamed the newsletter.",
      ]);
    });

    it("unwraps an answer returned inside one code fence (CUSTOM_AGENTS.md §5)", () => {
      expect(parseMemoryFlushBullets("```md\n- Renamed the newsletter.\n```")).toEqual([
        "Renamed the newsletter.",
      ]);
    });

    it("drops a heading the model used to label its own answer", () => {
      expect(parseMemoryFlushBullets("## Notes\n- Renamed the newsletter.")).toEqual([
        "Renamed the newsletter.",
      ]);
    });

    it("yields nothing for the agreed word, so a barren conversation writes no heading", () => {
      expect(parseMemoryFlushBullets("NOTHING")).toEqual([]);
      expect(parseMemoryFlushBullets("nothing")).toEqual([]);
    });

    it("yields nothing for an empty answer", () => {
      expect(parseMemoryFlushBullets("   \n ")).toEqual([]);
    });
  });

  describe("buildAgentMemoryConsolidationPrompt()", () => {
    const source = {
      agentName: "Jennifer",
      currentMemory: memoryFile(),
      notes: [{ date: "2026-09-17", text: "## 09:40 Newsletter\n\n- Renamed to Grid Notes." }],
      today: new Date(2026, 8, 17),
    };

    it("carries the current file and every note not yet folded in", () => {
      const prompt = buildAgentMemoryConsolidationPrompt(source);

      expect(prompt).toContain("You are Jennifer.");
      expect(prompt).toContain("Writes a weekly newsletter.");
      expect(prompt).toContain("### 2026-09-17");
      expect(prompt).toContain("Renamed to Grid Notes.");
    });

    it("states every rule the spec fixes for the rewrite (CUSTOM_AGENTS.md §5)", () => {
      const prompt = buildAgentMemoryConsolidationPrompt(source);

      expect(prompt).toContain("Keep what is still true");
      expect(prompt).toContain("merge duplicate entries");
      expect(prompt).toContain("rather than deleting it silently");
      expect(prompt).toContain("(2026-09-17)");
      expect(prompt).toContain("[[memory/2026-09-17]]");
      expect(prompt).toContain(String(AGENT_MEMORY_MAX_CHARS));
      expect(prompt).toContain("compress the oldest entries first");
      for (const heading of AGENT_MEMORY_HEADINGS) expect(prompt).toContain(`"${heading}"`);
    });

    it("asks for the whole file back with no wrapper, since the plugin owns the write", () => {
      expect(buildAgentMemoryConsolidationPrompt(source)).toContain(
        "complete new contents of the memory file and nothing else"
      );
    });

    it("says so plainly when there is nothing new, rather than rendering an empty section", () => {
      expect(buildAgentMemoryConsolidationPrompt({ ...source, notes: [] })).toContain("(none)");
    });
  });

  describe("boundConsolidationNotes()", () => {
    const note = (date: string, size: number) => ({ date, text: "x".repeat(size) });

    it("keeps every note when they fit the budget", () => {
      const notes = [note("2026-09-16", 10), note("2026-09-17", 10)];

      expect(boundConsolidationNotes(notes, 100)).toEqual(notes);
    });

    it("drops the oldest days first, because a later note is what corrects an earlier one", () => {
      const notes = [note("2026-09-15", 60), note("2026-09-16", 30), note("2026-09-17", 30)];

      expect(boundConsolidationNotes(notes, 100).map((entry) => entry.date)).toEqual([
        "2026-09-16",
        "2026-09-17",
      ]);
    });

    it("reads the tail of a single day longer than the whole budget, rather than nothing", () => {
      const kept = boundConsolidationNotes([{ date: "2026-09-17", text: "abcdef" }], 3);

      expect(kept).toEqual([{ date: "2026-09-17", text: "def" }]);
    });
  });

  describe("reviewMemoryUpdate()", () => {
    it("accepts a well-formed file and terminates it with a single newline", () => {
      const review = reviewMemoryUpdate(memoryFile(), memoryFile("- (2026-09-17) New entry."));

      expect(review).toMatchObject({ accepted: true });
      if (!review.accepted) throw new Error("expected acceptance");
      expect(review.text.endsWith("New entry.\n")).toBe(true);
    });

    it("unwraps a file the model returned inside one code fence (CUSTOM_AGENTS.md §5)", () => {
      const review = reviewMemoryUpdate(memoryFile(), "```markdown\n" + memoryFile() + "\n```");

      expect(review).toMatchObject({ accepted: true });
      if (!review.accepted) throw new Error("expected acceptance");
      expect(review.text.startsWith("# Jennifer's memory")).toBe(true);
      expect(review.text).not.toContain("```");
    });

    it("rejects an empty answer so the existing file stands (CUSTOM_AGENTS.md §5)", () => {
      expect(reviewMemoryUpdate(memoryFile(), "   \n  ")).toEqual({
        accepted: false,
        reason: "empty",
      });
    });

    it("rejects an answer that lost more than half the file (CUSTOM_AGENTS.md §5)", () => {
      const previous = memoryFile("- (2026-09-10) " + "x".repeat(600));

      expect(reviewMemoryUpdate(previous, memoryFile())).toEqual({
        accepted: false,
        reason: "shrank",
      });
    });

    it("accepts a compression pass that kept just over half the file", () => {
      const previous = `${memoryFile()}${"y".repeat(memoryFile().length - 2)}`;

      expect(reviewMemoryUpdate(previous, memoryFile())).toMatchObject({ accepted: true });
    });

    it("rejects an answer missing one of the fixed headings (CUSTOM_AGENTS.md §5)", () => {
      const withoutOngoing = memoryFile().replace("## Ongoing threads", "## Loose ends");

      expect(reviewMemoryUpdate(memoryFile(), withoutOngoing)).toEqual({
        accepted: false,
        reason: "missing-headings",
      });
    });

    it("accepts headings written at another level, since only the sections must survive", () => {
      const asH3 = memoryFile().replace(/^## /gm, "### ");

      expect(reviewMemoryUpdate(memoryFile(), asH3)).toMatchObject({ accepted: true });
    });

    it("does not mistake a heading named inside an entry for the heading itself", () => {
      const inProse = memoryFile().replace(
        "## Ongoing threads",
        "- talked about Ongoing threads today"
      );

      expect(reviewMemoryUpdate(memoryFile(), inProse)).toEqual({
        accepted: false,
        reason: "missing-headings",
      });
    });

    it("accepts the first real update over the skeleton a new agent starts with", () => {
      const skeleton = buildAgentMemorySkeleton("Jennifer");

      expect(reviewMemoryUpdate(skeleton, memoryFile())).toMatchObject({ accepted: true });
    });
  });
});

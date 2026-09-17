import {
  AGENT_MEMORY_INDEX_MAX_LINES,
  agentMemoryIndexCutoff,
  buildAgentMemoryIndex,
} from "@/agents/agentMemoryIndex";

/** One daily note, written the way a flush writes it. */
function note(date: string, ...sections: string[]) {
  return { date, text: `# ${date}\n\n${sections.join("\n\n")}\n` };
}

/** One conversation section: a heading and its bullets. */
function conversation(time: string, title: string, ...bullets: string[]) {
  return [`## ${time} ${title}`, "", ...bullets.map((bullet) => `- ${bullet}`)].join("\n");
}

describe("agentMemoryIndex", () => {
  describe("agentMemoryIndexCutoff()", () => {
    // The cutoff is exclusive, so a fourteen-day window is "after today minus
    // fourteen" and holds exactly fourteen days counting today.
    it("names the day before a fourteen-day window ending today", () => {
      expect(agentMemoryIndexCutoff(new Date(2026, 8, 17, 10, 0, 0))).toBe("2026-09-03");
    });

    it("steps the calendar rather than subtracting hours, so a month boundary lands right", () => {
      expect(agentMemoryIndexCutoff(new Date(2026, 8, 1, 10, 0, 0))).toBe("2026-08-18");
    });

    it("measures a window of the length the caller asks for", () => {
      expect(agentMemoryIndexCutoff(new Date(2026, 8, 17, 10, 0, 0), 1)).toBe("2026-09-16");
    });
  });

  describe("buildAgentMemoryIndex()", () => {
    it("writes one line per conversation with its day, time, title, summary, and note link", () => {
      const index = buildAgentMemoryIndex([
        note(
          "2026-09-17",
          conversation(
            "09:40",
            "Grid Notes intro",
            "Cut the intro to one paragraph.",
            "User prefers short leads."
          )
        ),
      ]);

      expect(index).toBe(
        "- 2026-09-17 09:40 Grid Notes intro · Cut the intro to one paragraph. [[memory/2026-09-17]]"
      );
    });

    it("lists the newest day first and, inside a day, the latest conversation first", () => {
      const index = buildAgentMemoryIndex([
        note("2026-09-15", conversation("11:00", "Older", "Older thing.")),
        note(
          "2026-09-17",
          conversation("09:40", "Morning", "Morning thing."),
          conversation("16:20", "Evening", "Evening thing.")
        ),
      ]);

      expect(index.split("\n").map((line) => line.split(" ")[3])).toEqual([
        "Evening",
        "Morning",
        "Older",
      ]);
    });

    it("writes a line without a summary for a heading that carries no bullets", () => {
      const index = buildAgentMemoryIndex([note("2026-09-17", "## 09:40 Untitled chat")]);

      expect(index).toBe("- 2026-09-17 09:40 Untitled chat [[memory/2026-09-17]]");
    });

    it("keeps only the first bullet, which is the one saying what the conversation was about", () => {
      const index = buildAgentMemoryIndex([
        note("2026-09-17", conversation("09:40", "Intro", "What it was about.", "A durable fact.")),
      ]);

      expect(index).toContain("What it was about.");
      expect(index).not.toContain("A durable fact.");
    });

    it("keeps the most recent conversations when the window holds more than the cap", () => {
      const notes = Array.from({ length: 6 }, (_, day) =>
        note(
          `2026-09-${`${day + 10}`.padStart(2, "0")}`,
          ...Array.from({ length: 10 }, (_, i) =>
            conversation(`${`${i + 8}`.padStart(2, "0")}:00`, `Chat ${day}-${i}`, "About it.")
          )
        )
      );

      const lines = buildAgentMemoryIndex(notes).split("\n");

      expect(lines).toHaveLength(AGENT_MEMORY_INDEX_MAX_LINES);
      expect(lines[0]).toContain("2026-09-15 17:00");
      expect(lines[AGENT_MEMORY_INDEX_MAX_LINES - 1]).toContain("2026-09-12 08:00");
    });

    it("honours a cap the caller asks for", () => {
      const index = buildAgentMemoryIndex(
        [
          note(
            "2026-09-17",
            conversation("09:40", "First", "One."),
            conversation("16:20", "Second", "Two.")
          ),
        ],
        1
      );

      expect(index).toBe("- 2026-09-17 16:20 Second · Two. [[memory/2026-09-17]]");
    });

    it("reports nothing for a window with no notes and for notes with no conversations", () => {
      expect(buildAgentMemoryIndex([])).toBe("");
      expect(buildAgentMemoryIndex([note("2026-09-17", "- a stray bullet")])).toBe("");
    });

    it("skips a day's own title and any heading that is not a timed conversation", () => {
      const index = buildAgentMemoryIndex([
        note(
          "2026-09-17",
          "## Notes to self",
          "- not a conversation",
          "## 25:00 Impossible",
          conversation("09:40", "Real", "Real thing.")
        ),
      ]);

      expect(index).toBe("- 2026-09-17 09:40 Real · Real thing. [[memory/2026-09-17]]");
    });
  });
});

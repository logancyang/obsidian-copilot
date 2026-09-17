import {
  appendToDailyNote,
  buildDailyNoteSection,
  formatDailyNoteTime,
  hashMemoryContent,
  parseAgentMemoryFile,
  serializeAgentMemoryFile,
} from "@/agents/agentMemoryFile";

describe("agentMemoryFile", () => {
  describe("parseAgentMemoryFile()", () => {
    it("splits the consolidation marker from the body a conversation is given", () => {
      const raw = "---\nconsolidated-through: 2026-09-17\n---\n\n# Jennifer's memory\n";

      expect(parseAgentMemoryFile(raw)).toEqual({
        body: "# Jennifer's memory\n",
        consolidatedThrough: "2026-09-17",
      });
    });

    // designdocs/CUSTOM_AGENTS.md §5: every MEMORY.md written before
    // consolidation existed has no frontmatter, and must still load.
    it("reads a file with no frontmatter as a body that has never been consolidated", () => {
      expect(parseAgentMemoryFile("# Jennifer's memory\n\n## About the user\n")).toEqual({
        body: "# Jennifer's memory\n\n## About the user\n",
        consolidatedThrough: null,
      });
    });

    it("reads a YAML date literal as the day, so an unquoted hand edit still counts", () => {
      const raw = "---\nconsolidated-through: 2026-09-17\n---\nbody\n";

      expect(parseAgentMemoryFile(raw).consolidatedThrough).toBe("2026-09-17");
    });

    it("ignores a marker that is not a day, rather than trusting a hand-typed word", () => {
      const raw = "---\nconsolidated-through: yesterday\n---\nbody\n";

      expect(parseAgentMemoryFile(raw).consolidatedThrough).toBeNull();
    });

    it("keeps the body when the frontmatter is mid-edit and will not parse", () => {
      const raw = "---\nconsolidated-through: [unclosed\n---\nbody\n";

      expect(parseAgentMemoryFile(raw)).toEqual({ body: "body\n", consolidatedThrough: null });
    });

    it("strips a byte-order mark so a synced file is not read as bodyless", () => {
      expect(parseAgentMemoryFile("﻿---\nconsolidated-through: 2026-09-17\n---\nbody\n")).toEqual({
        body: "body\n",
        consolidatedThrough: "2026-09-17",
      });
    });
  });

  describe("serializeAgentMemoryFile()", () => {
    it("writes the marker above the body and ends the file with one newline", () => {
      expect(serializeAgentMemoryFile("# Jennifer's memory", "2026-09-17")).toBe(
        "---\nconsolidated-through: 2026-09-17\n---\n\n# Jennifer's memory\n"
      );
    });

    it("round-trips through the parser, so a rewrite does not grow the file", () => {
      const once = serializeAgentMemoryFile("# Jennifer's memory", "2026-09-17");
      const parsed = parseAgentMemoryFile(once);

      expect(serializeAgentMemoryFile(parsed.body, parsed.consolidatedThrough)).toBe(once);
    });

    it("omits the frontmatter entirely when there is no marker to record", () => {
      expect(serializeAgentMemoryFile("# Jennifer's memory", null)).toBe("# Jennifer's memory\n");
    });
  });

  describe("hashMemoryContent()", () => {
    it("matches for identical contents and differs for an edited file", () => {
      expect(hashMemoryContent("a")).toBe(hashMemoryContent("a"));
      expect(hashMemoryContent("a")).not.toBe(hashMemoryContent("a "));
    });
  });

  describe("formatDailyNoteTime()", () => {
    it("renders a local time as HH:MM with zero padding", () => {
      expect(formatDailyNoteTime(new Date(2026, 8, 17, 9, 4))).toBe("09:04");
    });
  });

  describe("buildDailyNoteSection()", () => {
    const at = new Date(2026, 8, 17, 9, 40);

    it("heads the bullets with the time and the chat they came from (CUSTOM_AGENTS.md §5)", () => {
      const section = buildDailyNoteSection({
        at,
        chatTitle: "Newsletter rename",
        bullets: ["Renamed to Grid Notes Weekly.", "Publishes Wednesdays."],
      });

      expect(section).toBe(
        "## 09:40 Newsletter rename\n\n- Renamed to Grid Notes Weekly.\n- Publishes Wednesdays.\n"
      );
    });

    it("names an untitled chat rather than heading a section with a bare time", () => {
      expect(buildDailyNoteSection({ at, chatTitle: "  ", bullets: ["x"] })).toContain(
        "## 09:40 Untitled chat"
      );
    });

    it("collapses a title's newlines so one flush cannot break the heading in two", () => {
      expect(buildDailyNoteSection({ at, chatTitle: "Two\nlines", bullets: ["x"] })).toContain(
        "## 09:40 Two lines"
      );
    });

    it("drops blank bullets so a stray line never becomes an empty entry", () => {
      expect(buildDailyNoteSection({ at, chatTitle: "Chat", bullets: ["a", "  ", "b"] })).toContain(
        "- a\n- b"
      );
    });
  });

  describe("appendToDailyNote()", () => {
    const section = "## 09:40 Chat\n\n- a\n";

    it("titles a new day's note with its date", () => {
      expect(appendToDailyNote(null, "2026-09-17", section)).toBe(`# 2026-09-17\n\n${section}`);
    });

    it("adds one blank line between an existing day's sections", () => {
      const existing = "# 2026-09-17\n\n## 08:00 Earlier\n\n- older\n";

      expect(appendToDailyNote(existing, "2026-09-17", section)).toBe(
        `${existing.trimEnd()}\n\n${section}`
      );
    });

    it("treats a whitespace-only file as a new day, so a stray save still gets a title", () => {
      expect(appendToDailyNote("\n \n", "2026-09-17", section)).toBe(`# 2026-09-17\n\n${section}`);
    });
  });
});

import {
  deriveAgentSlug,
  deriveUniqueAgentSlug,
  getAgentFilePath,
  getAgentFolderPath,
  getAgentMemoryPath,
  formatAgentDailyNoteLink,
  getAgentDailyNotePath,
  getAgentMemoryFolderPath,
  parseAgentDailyNoteDate,
} from "@/agents/agentPaths";

describe("agentPaths", () => {
  describe("deriveAgentSlug()", () => {
    it("lowercases a one-word name into the folder name the spec shows", () => {
      expect(deriveAgentSlug("Jennifer")).toBe("jennifer");
    });

    it("joins the words of a multi-word name with single hyphens", () => {
      expect(deriveAgentSlug("Grid Storage Editor")).toBe("grid-storage-editor");
    });

    it("folds accents to their base letters rather than dropping them", () => {
      expect(deriveAgentSlug("Renée")).toBe("renee");
    });

    it("collapses punctuation and repeated separators into one hyphen", () => {
      expect(deriveAgentSlug("  Dr. Vancat — Jr.!!  ")).toBe("dr-vancat-jr");
    });

    it("truncates a very long name without leaving a trailing hyphen", () => {
      const slug = deriveAgentSlug("a".repeat(40) + " " + "b".repeat(40));
      expect(slug).toBe("a".repeat(40) + "-" + "b".repeat(7));
      expect(slug.endsWith("-")).toBe(false);
    });

    it("falls back to 'agent' for a name with nothing sluggable in it", () => {
      expect(deriveAgentSlug("🙂🙂")).toBe("agent");
      expect(deriveAgentSlug("")).toBe("agent");
    });

    // designdocs/CUSTOM_AGENTS.md §2: "Copilot" is the built-in entry and has
    // no folder, so no agent folder may claim its slug.
    it("keeps the reserved built-in slug free by suffixing a name that derives it", () => {
      expect(deriveAgentSlug("Copilot")).toBe("copilot-agent");
    });
  });

  describe("deriveUniqueAgentSlug()", () => {
    it("returns the plain slug when nothing has claimed it", () => {
      expect(deriveUniqueAgentSlug("Jennifer", ["vancat"])).toBe("jennifer");
    });

    it("suffixes the next free number when the slug is taken", () => {
      expect(deriveUniqueAgentSlug("Jennifer", ["jennifer"])).toBe("jennifer-2");
      expect(deriveUniqueAgentSlug("Jennifer", ["jennifer", "jennifer-2"])).toBe("jennifer-3");
    });

    it("treats a differently-cased existing folder as taken, since the disk does", () => {
      expect(deriveUniqueAgentSlug("Jennifer", ["Jennifer"])).toBe("jennifer-2");
    });
  });

  describe("getAgentFolderPath()", () => {
    it("places the agent directly under the agents root", () => {
      expect(getAgentFolderPath("copilot/agents", "jennifer")).toBe("copilot/agents/jennifer");
    });
  });

  describe("getAgentFilePath()", () => {
    it("names the identity record agent.md inside the agent folder", () => {
      expect(getAgentFilePath("copilot/agents", "jennifer")).toBe(
        "copilot/agents/jennifer/agent.md"
      );
    });
  });

  describe("getAgentMemoryPath()", () => {
    it("names the memory file MEMORY.md inside the agent folder", () => {
      expect(getAgentMemoryPath("team/ai/agents", "vancat")).toBe(
        "team/ai/agents/vancat/MEMORY.md"
      );
    });
  });

  describe("getAgentMemoryFolderPath()", () => {
    it("puts the daily notes in a `memory` folder inside the agent's own folder", () => {
      expect(getAgentMemoryFolderPath("copilot/agents", "jennifer")).toBe(
        "copilot/agents/jennifer/memory"
      );
    });
  });

  describe("getAgentDailyNotePath()", () => {
    it("names one day's note after the day it records", () => {
      expect(getAgentDailyNotePath("copilot/agents", "jennifer", "2026-09-17")).toBe(
        "copilot/agents/jennifer/memory/2026-09-17.md"
      );
    });
  });

  describe("parseAgentDailyNoteDate()", () => {
    it("reads the day out of a daily note's file name", () => {
      expect(parseAgentDailyNoteDate("2026-09-17.md")).toBe("2026-09-17");
    });

    // designdocs/CUSTOM_AGENTS.md §5: `memory/` is an ordinary vault folder, so
    // a note the user put there themselves is not read as the agent's memory.
    it("ignores a file whose name is not a day", () => {
      expect(parseAgentDailyNoteDate("scratch.md")).toBeNull();
      expect(parseAgentDailyNoteDate("2026-09-17.txt")).toBeNull();
      expect(parseAgentDailyNoteDate("2026-09-17 draft.md")).toBeNull();
    });
  });

  describe("formatAgentDailyNoteLink()", () => {
    it("anchors an entry to its source day, relative to the agent's folder", () => {
      expect(formatAgentDailyNoteLink("2026-09-17")).toBe("[[memory/2026-09-17]]");
    });
  });
});

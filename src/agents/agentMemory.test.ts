import { AGENT_MEMORY_HEADINGS, buildAgentMemorySkeleton } from "@/agents/agentFile";
import {
  AGENT_MEMORY_MAX_CHARS,
  buildAgentMemoryPrompt,
  formatMemoryEntryDate,
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

  describe("buildAgentMemoryPrompt()", () => {
    const source = {
      agentName: "Jennifer",
      currentMemory: memoryFile(),
      transcript: "<conversation_history>cut the hydrogen section</conversation_history>",
      today: new Date(2026, 8, 17),
    };

    it("addresses the agent by name and carries both its file and the new turns", () => {
      const prompt = buildAgentMemoryPrompt(source);

      expect(prompt).toContain("You are Jennifer.");
      expect(prompt).toContain("Writes a weekly newsletter.");
      expect(prompt).toContain("cut the hydrogen section");
    });

    it("states every rule the spec fixes for the update (CUSTOM_AGENTS.md §5)", () => {
      const prompt = buildAgentMemoryPrompt(source);

      expect(prompt).toContain("Keep what is still true");
      expect(prompt).toContain("merge duplicate entries");
      expect(prompt).toContain("rather than deleting it silently");
      expect(prompt).toContain("Never store the conversation itself.");
      expect(prompt).toContain("(2026-09-17)");
      expect(prompt).toContain(String(AGENT_MEMORY_MAX_CHARS));
      expect(prompt).toContain("compress the oldest entries first");
      for (const heading of AGENT_MEMORY_HEADINGS) expect(prompt).toContain(`"${heading}"`);
    });

    it("asks for the whole file back with no wrapper, since the plugin owns the write", () => {
      expect(buildAgentMemoryPrompt(source)).toContain(
        "complete new contents of the memory file and nothing else"
      );
    });

    it("falls back to a neutral subject when the agent has no readable name", () => {
      expect(buildAgentMemoryPrompt({ ...source, agentName: "  " })).toContain(
        "You are this agent."
      );
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

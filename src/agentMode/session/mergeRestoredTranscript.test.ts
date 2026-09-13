import { mergeRestoredTranscript } from "@/agentMode/session/mergeRestoredTranscript";
import type { AgentChatMessage } from "@/agentMode/session/types";

describe("mergeRestoredTranscript", () => {
  describe("mergeRestoredTranscript()", () => {
    const note: AgentChatMessage[] = [
      {
        id: "saved-question",
        sender: "user",
        timestamp: { display: "Saved time", fileName: "saved-time", epoch: 123 },
        isVisible: true,
        message: "Describe this ![[photo.png]]",
      },
    ];
    const backend: AgentChatMessage[] = [
      { ...note[0], id: "backend-question", timestamp: null, message: "Describe this" },
      { id: "new-answer", sender: "ai", timestamp: null, isVisible: true, message: "New answer" },
    ];

    it.each([0, 1])(
      "keeps the saved note when the backend has %s messages for https://github.com/logancyang/obsidian-copilot/issues/3225",
      (length) => {
        expect(mergeRestoredTranscript(note, backend.slice(0, length))).toBe(note);
      }
    );
    it("preserves image embeds and timestamps in a matching note prefix and appends newer turns for https://github.com/logancyang/obsidian-copilot/issues/3225", () => {
      expect(mergeRestoredTranscript(note, backend)).toEqual([note[0], backend[1]]);
      expect(note[0].message).toContain("![[photo.png]]");
    });
    it("uses the backend transcript when prefix senders disagree for https://github.com/logancyang/obsidian-copilot/issues/3225", () => {
      const mismatched = [{ ...backend[0], sender: "ai" }, backend[1]];
      expect(mergeRestoredTranscript(note, mismatched)).toBe(mismatched);
    });
  });
});

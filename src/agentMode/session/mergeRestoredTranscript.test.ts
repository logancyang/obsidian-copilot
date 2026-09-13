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
        message: "Describe   this\n\n![[photo.png]]",
      },
    ];
    const backend: AgentChatMessage[] = [
      { ...note[0], id: "backend-question", timestamp: null, message: "Describe this" },
      { id: "new-answer", sender: "ai", timestamp: null, isVisible: true, message: "New answer" },
    ];

    it.each([0, 1])(
      "keeps the saved note when the backend has %s messages for https://github.com/logancyang/obsidian-copilot/issues/3225",
      (length) => {
        expect(mergeRestoredTranscript(note, backend.slice(0, length))).toEqual(note);
      }
    );
    it("preserves image embeds and timestamps in a matching note prefix and appends newer turns for https://github.com/logancyang/obsidian-copilot/issues/3225", () => {
      expect(mergeRestoredTranscript(note, backend)).toEqual([note[0], backend[1]]);
      expect(note[0].message).toContain("![[photo.png]]");
    });
    it.each([false, true])(
      "completes a saved partial AI bubble with later turns=%s for https://github.com/logancyang/obsidian-copilot/issues/3225",
      (withTail) => {
        const partial = { ...backend[1], message: "Partial", timestamp: note[0].timestamp };
        const saved = [note[0], partial];
        const completed = { ...backend[1], message: "Partial answer completed" };
        const tail = withTail ? [{ ...backend[0], id: "later", message: "Next question" }] : [];
        expect(mergeRestoredTranscript(saved, [backend[0], completed, ...tail])).toEqual([
          note[0],
          { ...partial, message: completed.message },
          ...tail,
        ]);
      }
    );
    it("appends normal turns after note-only fan-out turns for https://github.com/logancyang/obsidian-copilot/issues/3225", () => {
      const fanout = [
        { ...note[0], message: "Ask the team" },
        { ...backend[1], message: "Team answer" },
      ];
      expect(mergeRestoredTranscript(fanout, backend)).toEqual([...fanout, ...backend]);
    });
    it("finds the last user anchor mid-transcript and appends only later turns for https://github.com/logancyang/obsidian-copilot/issues/3225", () => {
      const earlier = [{ ...backend[0], message: "Earlier question" }, backend[1]];
      const saved = [...note, backend[1]];
      const later = [{ ...backend[0], message: "Later question" }, backend[1]];
      expect(mergeRestoredTranscript(saved, [...earlier, ...backend, ...later])).toEqual([
        ...saved,
        ...later,
      ]);
    });
    it("keeps the note when only an earlier user message matches for https://github.com/logancyang/obsidian-copilot/issues/3225", () => {
      const saved = [...note, backend[1], { ...note[0], message: "Unsynced final turn" }];
      expect(mergeRestoredTranscript(saved, backend)).toBe(saved);
    });
  });
});

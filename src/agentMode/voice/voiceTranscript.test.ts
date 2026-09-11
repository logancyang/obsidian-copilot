import { VoiceTranscriptAssembler } from "@/agentMode/voice/voiceTranscript";

describe("voiceTranscript", () => {
  describe("VoiceTranscriptAssembler", () => {
    describe("hasUserSpeech()", () => {
      it.each([
        ["user", "Find notes about Obsidian", true],
        ["assistant", "I will search now", false],
        ["user", " \n ", false],
      ] as const)("reports usable speech for %s text %j as %s", (role, delta, expected) => {
        const transcript = new VoiceTranscriptAssembler();
        transcript.ingest({
          voiceSessionId: "voice-1",
          liveEventId: "fragment-1",
          role,
          delta,
          startMs: 100,
          endMs: 200,
        });
        expect(transcript.hasUserSpeech()).toBe(expected);
      });

      it("reports no user speech before any transcript arrives", () => {
        expect(new VoiceTranscriptAssembler().hasUserSpeech()).toBe(false);
      });

      it("retains speech presence after claiming it so ownership is checked separately", () => {
        const transcript = new VoiceTranscriptAssembler();
        transcript.ingest({
          voiceSessionId: "voice-1",
          liveEventId: "fragment-1",
          role: "user",
          delta: "Find notes about Obsidian",
          startMs: 100,
          endMs: 200,
        });
        transcript.claimUserSpeech();
        expect(transcript.hasUserSpeech()).toBe(true);
        expect(transcript.claimUserSpeech()).toBeNull();
      });
    });
  });
});

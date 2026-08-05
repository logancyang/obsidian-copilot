import {
  initialTypewriterState,
  nextTypewriterFrame,
  shufflePrompts,
  TYPEWRITER_TIMINGS,
  visiblePromptText,
  type TypewriterState,
} from "@/components/chat-components/utils/promptTypewriter";

const PROMPTS = ["ab", "cd"] as const;

/**
 * Drive the machine until `frames` frames have been produced, collecting what
 * the composer would show at each one alongside how long the frame *before* it
 * stayed up — the scheduler's contract: wait `delayMs`, then show `text`.
 */
function run(
  prompts: readonly string[],
  frames: number,
  instant = false
): { text: string; delayMs: number }[] {
  let state = initialTypewriterState();
  const timeline: { text: string; delayMs: number }[] = [];
  for (let i = 0; i < frames; i++) {
    const next = nextTypewriterFrame(state, prompts, instant);
    timeline.push({ text: visiblePromptText(next.state, prompts), delayMs: next.delayMs });
    state = next.state;
  }
  return timeline;
}

describe("promptTypewriter", () => {
  describe("initialTypewriterState()", () => {
    it("opens on the first prompt with nothing typed yet", () => {
      expect(initialTypewriterState()).toEqual({ index: 0, charCount: 0, phase: "typing" });
    });
  });

  describe("visiblePromptText()", () => {
    it("shows only the leading characters the frame has typed", () => {
      const state: TypewriterState = { index: 1, charCount: 1, phase: "typing" };
      expect(visiblePromptText(state, PROMPTS)).toBe("c");
    });
  });

  describe("nextTypewriterFrame()", () => {
    const { typeMs, deleteMs, holdMs, gapMs } = TYPEWRITER_TIMINGS;

    it("types a prompt in one character at a time, then leaves the whole thing up for the hold", () => {
      expect(run(PROMPTS, 3)).toEqual([
        { text: "a", delayMs: typeMs },
        { text: "ab", delayMs: typeMs },
        // The completed prompt is the held frame, so holdMs is what elapses
        // before the first character comes back off.
        { text: "a", delayMs: holdMs },
      ]);
    });

    it("deletes a character at a time and moves on to the next prompt", () => {
      expect(run(PROMPTS, 6).slice(3)).toEqual([
        // Cleared, then the empty beat before the next prompt starts typing.
        { text: "", delayMs: deleteMs },
        { text: "", delayMs: gapMs },
        { text: "c", delayMs: typeMs },
      ]);
    });

    it("cycles back to the first prompt after the last one clears", () => {
      const wrapped = nextTypewriterFrame(
        { index: PROMPTS.length - 1, charCount: 0, phase: "gap" },
        PROMPTS
      );
      expect(wrapped.state).toEqual({ index: 0, charCount: 0, phase: "typing" });
    });

    it("shows and clears whole prompts with no per-character motion when instant", () => {
      expect(run(PROMPTS, 4, true)).toEqual([
        { text: "ab", delayMs: typeMs },
        { text: "", delayMs: holdMs },
        { text: "", delayMs: gapMs },
        { text: "cd", delayMs: typeMs },
      ]);
    });

    it("passes through a zero-length prompt instead of stalling on it", () => {
      const timeline = run(["", "cd"], 4);
      expect(timeline.map((frame) => frame.text)).toEqual(["", "", "", "c"]);
    });
  });

  describe("shufflePrompts()", () => {
    it("returns a reordered copy, leaving the source pool untouched", () => {
      const source = Object.freeze(["a", "b", "c", "d"]);
      const shuffled = shufflePrompts(source);
      expect([...shuffled].sort()).toEqual(["a", "b", "c", "d"]);
      expect(source).toEqual(["a", "b", "c", "d"]);
    });

    it("walks the pool back to front, swapping with the drawn index", () => {
      // Every draw lands on 0: [a,b,c] -> swap(2,0) -> [c,b,a] -> swap(1,0) -> [b,c,a].
      jest.spyOn(Math, "random").mockReturnValue(0);
      expect(shufflePrompts(["a", "b", "c"])).toEqual(["b", "c", "a"]);
      jest.spyOn(Math, "random").mockRestore();
    });
  });
});

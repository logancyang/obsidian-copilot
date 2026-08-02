/**
 * Frame machine behind the composer's rotating sample prompts: one prompt types
 * in a character at a time, holds while it's fully readable, deletes itself the
 * same way, and hands over to the next. Kept as pure transitions (no timers, no
 * React) so the cadence is testable and the component stays a thin renderer.
 */

export type TypewriterPhase = "typing" | "holding" | "deleting" | "gap";

export interface TypewriterState {
  /** Index into the prompt pool of the prompt currently on screen. */
  index: number;
  /** How many of that prompt's leading characters are visible. */
  charCount: number;
  /** `gap` is the cleared beat between one prompt and the next. */
  phase: TypewriterPhase;
}

/**
 * Per-phase pacing, in milliseconds. Deleting runs faster than typing because
 * that's how a person clears a line — they hold backspace.
 */
export const TYPEWRITER_TIMINGS = Object.freeze({
  typeMs: 45,
  deleteMs: 25,
  /** How long a fully-typed prompt stays put before it starts deleting. */
  holdMs: 5000,
  /** Empty-composer beat between one prompt clearing and the next starting. */
  gapMs: 500,
});

export const initialTypewriterState = (): TypewriterState => ({
  index: 0,
  charCount: 0,
  phase: "typing",
});

/** The characters of `state`'s prompt that are currently on screen. */
export function visiblePromptText(state: TypewriterState, prompts: readonly string[]): string {
  return prompts[state.index].slice(0, state.charCount);
}

/**
 * Advance one frame: wait `delayMs`, then put `state` on screen.
 *
 * A phase's dwell is therefore returned by the transition *out of* it — the
 * held frame is what stays for `holdMs`, so `holdMs` is what the hold hands to
 * the first delete step.
 *
 * @param state The frame currently on screen.
 * @param prompts The prompt pool, cycled in order. Must not be empty.
 * @param instant Skip the per-character animation and jump straight to the
 *   whole prompt (and straight back to empty) — how the rotation renders for a
 *   reader who asked their OS for reduced motion.
 */
export function nextTypewriterFrame(
  state: TypewriterState,
  prompts: readonly string[],
  instant = false
): { state: TypewriterState; delayMs: number } {
  const prompt = prompts[state.index];
  const { typeMs, deleteMs, holdMs, gapMs } = TYPEWRITER_TIMINGS;

  switch (state.phase) {
    case "typing": {
      const charCount = instant ? prompt.length : Math.min(state.charCount + 1, prompt.length);
      const phase = charCount >= prompt.length ? "holding" : "typing";
      return { state: { ...state, charCount, phase }, delayMs: typeMs };
    }
    // Holding and deleting clear the same way — a held frame is a full one, so
    // "one character less" is the first delete step for both — and differ only
    // in how long the frame they're replacing stayed up.
    case "holding":
    case "deleting": {
      const charCount = instant ? 0 : Math.max(state.charCount - 1, 0);
      return {
        state: { ...state, charCount, phase: charCount > 0 ? "deleting" : "gap" },
        delayMs: state.phase === "holding" ? holdMs : deleteMs,
      };
    }
    case "gap":
      return {
        state: { index: (state.index + 1) % prompts.length, charCount: 0, phase: "typing" },
        delayMs: gapMs,
      };
  }
}

/**
 * Fisher-Yates copy, so a pool cycles in a different order every time the
 * composer mounts instead of always opening on the same prompt.
 */
export function shufflePrompts(prompts: readonly string[]): string[] {
  const shuffled = [...prompts];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

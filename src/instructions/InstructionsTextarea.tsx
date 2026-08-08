import {
  initialTypewriterState,
  nextTypewriterFrame,
  shufflePrompts,
  visiblePromptText,
} from "@/components/chat-components/utils/promptTypewriter";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import React, { useEffect, useMemo, useState } from "react";

/**
 * Examples the empty instruction editors type out, one at a time, to show what belongs in an
 * AGENTS.md. Each names a convention of the user's own vault — where things go, how they are
 * named — rather than a way to format an answer, because that is what is worth writing down
 * once and keeping.
 *
 * Frozen so the rotation is not reshuffled by a new array identity on every render.
 */
export const INSTRUCTION_EXAMPLES: readonly string[] = Object.freeze([
  "e.g. Put new notes you create in Inbox/ and link them to a related note.",
  "e.g. Always have prefix YYYY-MM-DD in filenames.",
]);

export interface InstructionsTextareaProps {
  /** Current instruction text; empty is what lets the examples show. */
  value: string;
  onChange: (next: string) => void;
  /**
   * Accessible name for the editor. Its hosts render the visible title as plain text rather
   * than a `<label>`, so without this the field reaches a screen reader unnamed.
   */
  label: string;
  /**
   * Non-empty pool of examples to cycle through. Must be referentially stable (a frozen
   * module constant) — a new array identity reshuffles the pool and restarts the rotation.
   */
  examples?: readonly string[];
  className?: string;
}

/**
 * Instruction editor whose placeholder rotates through examples the way the chat composer's
 * does: one types in a character at a time, holds while it is readable, clears itself, and
 * gives way to the next.
 *
 * It exists as its own component so that ~22fps of animation re-renders this textarea alone
 * rather than the settings tab or the project dialog hosting it. The rotation also stops
 * while the field has text, since a placeholder nobody can see is not worth animating.
 */
export const InstructionsTextarea: React.FC<InstructionsTextareaProps> = ({
  value,
  onChange,
  label,
  examples = INSTRUCTION_EXAMPLES,
  className,
}) => {
  const pool = useMemo(() => shufflePrompts(examples), [examples]);
  // Read once at mount: an OS preference nobody flips mid-edit, so this stays free of a
  // media-query subscription.
  const [instant] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
  );
  const [state, setState] = useState(initialTypewriterState);

  // Each frame schedules the next one, so the per-phase delays vary without an interval that
  // has to be reconciled against them.
  const idle = value.length > 0;
  useEffect(() => {
    if (idle) return;
    const { state: next, delayMs } = nextTypewriterFrame(state, pool, instant);
    const timer = window.setTimeout(() => setState(next), delayMs);
    return () => window.clearTimeout(timer);
  }, [idle, state, pool, instant]);

  return (
    <Textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      placeholder={visiblePromptText(state, pool)}
      className={cn("tw-min-h-32 tw-w-full", className)}
    />
  );
};

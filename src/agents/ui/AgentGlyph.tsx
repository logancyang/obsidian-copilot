import { cn } from "@/lib/utils";
import React from "react";

export interface AgentGlyphProps {
  /** The agent's emoji or letter; an empty string still reserves the box. */
  icon: string;
  className?: string;
}

/**
 * An agent's emoji in a fixed box, so every surface that names an agent — the
 * talking-to picker, the `@` typeahead, the composer pill, a fan-out answer tab
 * — keeps one leading width whether the agent set an icon or not.
 */
export const AgentGlyph: React.FC<AgentGlyphProps> = ({ icon, className }) => (
  <span
    aria-hidden="true"
    className={cn(
      // Sized by the same UI token as the labels it sits beside, so the emoji
      // reads at the weight of the lucide icons sharing its column.
      "tw-flex tw-size-4 tw-shrink-0 tw-items-center tw-justify-center tw-text-ui-small",
      className
    )}
  >
    {icon}
  </span>
);

AgentGlyph.displayName = "AgentGlyph";

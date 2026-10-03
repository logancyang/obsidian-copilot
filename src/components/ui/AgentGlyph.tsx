import { cn } from "@/lib/utils";
import React from "react";

export interface AgentGlyphProps {
  icon: string;
  className?: string;
}

export const AgentGlyph: React.FC<AgentGlyphProps> = ({ icon, className }) => (
  <span
    aria-hidden="true"
    className={cn(
      "tw-flex tw-size-4 tw-shrink-0 tw-items-center tw-justify-center tw-text-ui-small",
      className
    )}
  >
    {icon}
  </span>
);

AgentGlyph.displayName = "AgentGlyph";

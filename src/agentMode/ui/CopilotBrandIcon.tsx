import { COPILOT_AGENT_ICON_SVG } from "@/constants";
import { cn } from "@/lib/utils";
import React from "react";

interface CopilotBrandIconProps {
  className?: string;
}

/**
 * The Copilot brand mark as an inline SVG, sized and colored by `className`
 * (the path fills with `currentColor`). Reuses the exact same normalized
 * `0 0 100 100` markup registered with Obsidian's `addIcon`, so the React
 * surface and the native view/ribbon/command icon can never drift.
 */
export const CopilotBrandIcon: React.FC<CopilotBrandIconProps> = ({ className }) => (
  <svg
    viewBox="0 0 100 100"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={cn("tw-shrink-0", className)}
    // Reason: the brand mark lives as a trusted module constant (not user input),
    // so injecting it avoids duplicating the path and keeps it in lockstep with
    // the Obsidian-registered icon.
    dangerouslySetInnerHTML={{ __html: COPILOT_AGENT_ICON_SVG }}
  />
);

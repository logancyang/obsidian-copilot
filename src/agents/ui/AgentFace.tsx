import { cn } from "@/lib/utils";
import React from "react";

export type AgentFaceSize = "xs" | "s" | "m" | "l";

const FACE_SIZE_CLASS: Record<AgentFaceSize, string> = {
  xs: "tw-size-4",
  s: "tw-size-5",
  m: "tw-size-7",
  l: "tw-size-9",
};

export const SELECTED_FACE_CLASS =
  "tw-outline tw-outline-2 tw-outline-offset-2 tw-outline-[color:var(--text-muted)]";

export interface AgentFaceProps {
  src: string;
  size: AgentFaceSize;
  selected?: boolean;
  running?: boolean;
  className?: string;
}

export function AgentFace({
  src,
  size,
  selected,
  running,
  className,
}: AgentFaceProps): React.ReactElement {
  const face = (
    <img
      src={src}
      alt=""
      draggable={false}
      className={cn(
        "tw-shrink-0 tw-rounded-full tw-bg-primary tw-object-cover",
        FACE_SIZE_CLASS[size],
        selected && SELECTED_FACE_CLASS,
        !running && className
      )}
    />
  );
  if (!running) return face;
  return (
    <span className={cn("tw-relative tw-inline-flex tw-shrink-0", className)}>
      {face}
      <span
        aria-hidden="true"
        data-agent-face-ring="running"
        className="tw-pointer-events-none tw-absolute -tw-inset-[3px] tw-animate-spin tw-rounded-full tw-border-[1.5px] tw-border-solid tw-border-transparent tw-border-r-[color:var(--color-blue)] tw-border-t-[color:var(--color-blue)]"
      />
    </span>
  );
}

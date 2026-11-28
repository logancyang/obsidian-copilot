import { cn } from "@/lib/utils";
import { Lock } from "lucide-react";
import React from "react";

export type AgentFaceSize = "xs" | "s" | "m" | "l" | "roster" | "xl" | "xxl";

const FACE_SIZE_CLASS: Record<AgentFaceSize, string> = {
  xs: "tw-size-4",
  s: "tw-size-5",
  m: "tw-size-7",
  l: "tw-size-9",
  roster: "tw-size-[42px]",
  xl: "tw-size-16",
  xxl: "tw-size-[88px]",
};

export const SELECTED_FACE_CLASS =
  "tw-outline tw-outline-[3px] tw-outline-offset-2 tw-outline-[color:var(--interactive-accent)]";

// The row's smaller faces sit 8px apart, so their ring is thinner to stay clear of the next face.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/588
export const ROSTER_SELECTED_FACE_CLASS =
  "tw-outline tw-outline-2 tw-outline-offset-2 tw-outline-[color:var(--interactive-accent)]";

export const LOCKED_FACE_CLASS = "tw-opacity-50 tw-grayscale";

export const FACE_BADGE_CLASS =
  "tw-absolute -tw-bottom-1 -tw-right-1 tw-flex tw-size-5 tw-items-center tw-justify-center tw-rounded-full tw-border tw-border-solid tw-border-border tw-bg-primary tw-text-muted";

export function LockBadge(): React.ReactElement {
  return (
    <span className={FACE_BADGE_CLASS}>
      <Lock className="tw-size-3" />
    </span>
  );
}

export interface AgentFaceProps {
  src: string;
  size: AgentFaceSize;
  selected?: boolean;
  running?: boolean;
  locked?: boolean;
  className?: string;
}

export function AgentFace({
  src,
  size,
  selected,
  running,
  locked,
  className,
}: AgentFaceProps): React.ReactElement {
  const wrapped = running || locked;
  const face = (
    <img
      src={src}
      alt=""
      draggable={false}
      className={cn(
        "tw-shrink-0 tw-rounded-full tw-bg-primary tw-object-cover",
        FACE_SIZE_CLASS[size],
        selected && (size === "roster" ? ROSTER_SELECTED_FACE_CLASS : SELECTED_FACE_CLASS),
        locked && LOCKED_FACE_CLASS,
        !wrapped && className
      )}
    />
  );
  if (!wrapped) return face;
  return (
    <span className={cn("tw-relative tw-inline-flex tw-shrink-0", className)}>
      {face}
      {running && (
        <span
          aria-hidden="true"
          data-agent-face-ring="running"
          className="tw-pointer-events-none tw-absolute -tw-inset-[3px] tw-animate-spin tw-rounded-full tw-border-[1.5px] tw-border-solid tw-border-transparent tw-border-r-[color:var(--color-blue)] tw-border-t-[color:var(--color-blue)]"
        />
      )}
      {locked && <LockBadge />}
    </span>
  );
}

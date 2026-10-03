import { cn } from "@/lib/utils";
import React, { useState } from "react";

const SIZE_CLASSES = {
  md: "tw-size-10 tw-text-ui-medium",
  xl: "tw-size-20 tw-text-3xl",
} as const;

export type AgentAvatarSize = keyof typeof SIZE_CLASSES;

export interface AgentAvatarProps {
  src: string | null;
  name: string;
  size: AgentAvatarSize;
  fallback?: React.ReactNode;
  className?: string;
}

export function useImageLoadable(src: string | null): [boolean, () => void] {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return [src !== null && failedSrc !== src, () => setFailedSrc(src)];
}

export function agentInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export const AgentAvatar: React.FC<AgentAvatarProps> = ({
  src,
  name,
  size,
  fallback,
  className,
}) => {
  const [showImage, markFailed] = useImageLoadable(src);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "tw-flex tw-shrink-0 tw-items-center tw-justify-center tw-overflow-hidden tw-rounded-full",
        "tw-border tw-border-solid tw-border-border tw-bg-secondary tw-font-semibold tw-leading-none tw-text-muted",
        SIZE_CLASSES[size],
        className
      )}
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt=""
          draggable={false}
          onError={markFailed}
          className="tw-size-full tw-object-cover"
        />
      ) : (
        (fallback ?? agentInitial(name))
      )}
    </span>
  );
};

AgentAvatar.displayName = "AgentAvatar";

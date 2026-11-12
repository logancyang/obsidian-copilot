import { agentInitial, useImageLoadable } from "@/components/ui/AgentAvatar";
import { cn } from "@/lib/utils";
import React from "react";

export interface AgentGlyphProps {
  name: string;
  avatarSrc?: string | null;
  fallback?: React.ReactNode;
  className?: string;
}

export const AgentGlyph: React.FC<AgentGlyphProps> = ({
  name,
  avatarSrc = null,
  fallback,
  className,
}) => {
  const [showImage, markFailed] = useImageLoadable(avatarSrc);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "tw-flex tw-size-4 tw-shrink-0 tw-items-center tw-justify-center tw-overflow-hidden tw-rounded-full",
        !showImage &&
          !fallback &&
          "tw-bg-secondary tw-text-smallest tw-font-semibold tw-text-muted",
        className
      )}
    >
      {showImage ? (
        <img
          src={avatarSrc ?? undefined}
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

AgentGlyph.displayName = "AgentGlyph";

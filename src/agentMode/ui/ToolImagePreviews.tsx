import type { AgentToolCallOutput } from "@/agentMode/session/types";
import React from "react";

const PREVIEW_BOX =
  "tw-size-20 tw-rounded tw-border tw-border-solid tw-border-border tw-bg-secondary-alt";

export interface ToolImagePreviewsProps {
  outputs?: readonly AgentToolCallOutput[];
  label: string;
}

export function ToolImagePreviews({ outputs, label }: ToolImagePreviewsProps) {
  const images = outputs?.filter((o) => o.type === "image" || o.type === "image_pending");
  if (!images?.length) return null;
  return (
    <div className="tw-flex tw-flex-wrap tw-gap-2 tw-py-1">
      {images.map((image, index) =>
        image.type === "image" ? (
          <img
            // eslint-disable-next-line @eslint-react/no-array-index-key -- result order identifies each image within its tool call
            key={index}
            src={`data:${image.mimeType};base64,${image.data}`}
            alt={`Image viewed by agent: ${label} (${index + 1})`}
            className={`${PREVIEW_BOX} tw-object-contain`}
          />
        ) : (
          <div
            // eslint-disable-next-line @eslint-react/no-array-index-key -- result order identifies each image within its tool call
            key={index}
            aria-label={`Preparing image viewed by agent: ${label} (${index + 1})`}
            aria-busy="true"
            className={PREVIEW_BOX}
          />
        )
      )}
    </div>
  );
}

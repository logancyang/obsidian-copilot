import type { AgentToolCallOutput } from "@/agentMode/session/types";
import React from "react";

const PREVIEW_BOX =
  "tw-size-20 tw-rounded tw-border tw-border-solid tw-border-border tw-bg-secondary-alt";

export interface ToolImagePreviewsProps {
  outputs?: readonly AgentToolCallOutput[];
  label: string;
  openImage?: Pick<React.AnchorHTMLAttributes<HTMLAnchorElement>, "onClick" | "onAuxClick">;
}

export function ToolImagePreviews({ outputs, label, openImage }: ToolImagePreviewsProps) {
  const images = outputs?.filter((o) => o.type === "image" || o.type === "image_pending");
  if (!images?.length) return null;
  return (
    <div className="tw-flex tw-flex-wrap tw-gap-2 tw-py-1">
      {images.map((image, index) => {
        if (image.type === "image_pending") {
          return (
            <div
              // eslint-disable-next-line @eslint-react/no-array-index-key -- result order identifies each image within its tool call
              key={index}
              aria-label={`Preparing image viewed by agent: ${label} (${index + 1})`}
              aria-busy="true"
              className={PREVIEW_BOX}
            />
          );
        }
        const thumbnail = (
          <img
            src={`data:${image.mimeType};base64,${image.data}`}
            alt={`Image viewed by agent: ${label} (${index + 1})`}
            className={`${PREVIEW_BOX} tw-object-contain`}
          />
        );
        // A thumbnail keeps no full-size copy, so a click opens the file the agent read. https://github.com/logancyang/obsidian-copilot/issues/4248
        return openImage ? (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- result order identifies each image within its tool call
          <a key={index} href="#" className="tw-flex" {...openImage}>
            {thumbnail}
          </a>
        ) : (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- result order identifies each image within its tool call
          <React.Fragment key={index}>{thumbnail}</React.Fragment>
        );
      })}
    </div>
  );
}

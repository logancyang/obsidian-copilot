import { CopilotSpinner } from "@/components/chat-components/CopilotSpinner";
import React from "react";

interface BottomLoadingIndicatorProps {
  label?: string;
}

export const BottomLoadingIndicator: React.FC<BottomLoadingIndicatorProps> = ({
  label = "Thinking",
}) => {
  return (
    <div
      className="tw-mb-2 tw-mt-1 tw-w-full tw-text-ui-medium max-md:tw-mb-1.5 max-md:tw-mt-0.5"
      role="status"
      aria-live="polite"
    >
      <div className="tw-flex tw-w-full tw-items-center tw-gap-1.5 tw-text-left tw-text-ui-small tw-text-muted">
        <span className="tw-flex tw-size-icon-xs tw-shrink-0 tw-items-center tw-justify-center">
          <CopilotSpinner />
        </span>
        <span className="copilot-shimmer-text tw-font-medium">{label}</span>
        {/* Reserves the chevron slot AgentReasoningBlock renders so the
            swap to a real reasoning block doesn't shift the right edge. */}
        <span className="tw-ml-auto tw-size-3" aria-hidden="true" />
      </div>
    </div>
  );
};

export default BottomLoadingIndicator;

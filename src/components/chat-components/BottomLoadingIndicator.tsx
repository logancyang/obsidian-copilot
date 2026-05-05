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
      className="tw-flex tw-w-full tw-items-center tw-gap-2 tw-px-3 tw-py-2"
      role="status"
      aria-live="polite"
    >
      <CopilotSpinner />
      <span
        // eslint-disable-next-line tailwindcss/no-custom-classname
        className="copilot-shimmer-text tw-text-sm"
      >
        {label}
      </span>
    </div>
  );
};

export default BottomLoadingIndicator;

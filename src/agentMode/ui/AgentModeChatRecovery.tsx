import {
  ModelEffortPicker,
  type ModelEffortPickerOverride,
} from "@/components/ui/ModelEffortPicker";
import React, { type ReactNode } from "react";

interface AgentModeChatRecoveryProps {
  picker: ModelEffortPickerOverride | null;
  children: ReactNode;
  controls: ReactNode;
}

/** Keeps model selection available while the chosen agent cannot run.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/480
 */
export function AgentModeChatRecovery({ picker, children, controls }: AgentModeChatRecoveryProps) {
  return (
    <div className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
      <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-overflow-y-auto">
        <div className="tw-mt-auto">{children}</div>
      </div>
      <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2 tw-p-2">
        {picker && <ModelEffortPicker override={picker} />}
      </div>
      {controls}
    </div>
  );
}

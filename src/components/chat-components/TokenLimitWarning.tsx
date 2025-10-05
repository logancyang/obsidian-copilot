import { getModelKey } from "@/aiParams";
import { Button } from "@/components/ui/button";
import { getModelKeyFromModel, getSettings, updateSetting } from "@/settings/model";
import { ModelEditModal } from "@/settings/v2/components/ModelEditDialog";
import { ChatMessage } from "@/types/message";
import { AlertTriangle } from "lucide-react";
import { App, Notice } from "obsidian";
import React from "react";

interface TokenLimitWarningProps {
  message: ChatMessage;
  app: App;
}

/**
 * Warning message component displayed when AI response is truncated due to token limits.
 * Shows a clear message and provides a button to open model settings.
 */
export const TokenLimitWarning: React.FC<TokenLimitWarningProps> = ({ message, app }) => {
  const handleOpenSettings = () => {
    const settings = getSettings();
    const currentModelKey = getModelKey();

    // Find the current model
    const model = settings.activeModels.find((m) => getModelKeyFromModel(m) === currentModelKey);

    if (!model) {
      new Notice("Could not find the current model settings");
      return;
    }

    // Create update handler
    const handleModelUpdate = (isEmbedding: boolean, original: any, updated: any) => {
      const updatedModels = settings.activeModels.map((m) => (m === original ? updated : m));
      updateSetting("activeModels", updatedModels);
    };

    // Open the model edit modal
    const modal = new ModelEditModal(app, model, false, handleModelUpdate);
    modal.open();
  };

  return (
    <div className="tw-mt-3 tw-rounded-md tw-border tw-border-border tw-bg-callout-warning/20 tw-p-4">
      <div className="tw-flex tw-items-start tw-gap-3">
        <AlertTriangle className="tw-size-5 tw-shrink-0 tw-text-warning" />
        <div className="tw-flex-1">
          <div className="tw-mb-2 tw-font-semibold tw-text-warning">Response Truncated</div>
          <div className="tw-mb-3 tw-text-normal">
            The AI response was cut off because it reached the token limit. You can increase the
            &apos;Token Limit&apos; in model settings for longer responses.
          </div>
          {message.responseMetadata?.tokenUsage && (
            <div className="tw-mb-3 tw-text-sm tw-text-muted">
              Output tokens used: {message.responseMetadata.tokenUsage.outputTokens || "N/A"}
            </div>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleOpenSettings}
            className="tw-text-warning hover:tw-bg-callout-warning/10"
          >
            Open Model Settings
          </Button>
        </div>
      </div>
    </div>
  );
};

import { useChatBackendModelOptions } from "@/hooks/useChatBackendModelOptions";
import { updateBackendDefaultModel, useSettingsValue } from "@/settings/model";
import { ChatModelEnableList } from "@/settings/v2/components/ChatModelEnableList";
import { QuickChatModelSettings } from "@/settings/v2/components/ui/QuickChatModelSettings";
import React from "react";

/** Binds shared Quick Chat controls to the model registry on desktop and mobile. */
export const QuickChatPanel: React.FC = () => {
  const settings = useSettingsValue();
  const { options, resolveSelectionId } = useChatBackendModelOptions();
  return (
    <QuickChatModelSettings
      defaultModelId={resolveSelectionId(settings.backends?.chat?.default?.configuredModelId)}
      options={options}
      onDefaultModelChange={(value) =>
        updateBackendDefaultModel("chat", { configuredModelId: value })
      }
    >
      <ChatModelEnableList />
    </QuickChatModelSettings>
  );
};

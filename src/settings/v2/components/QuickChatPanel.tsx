import { useChatBackendModelOptions } from "@/hooks/useChatBackendModelOptions";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { ChatModelEnableList } from "@/settings/v2/components/ChatModelEnableList";
import { QuickChatModelSettings } from "@/settings/v2/components/ui/QuickChatModelSettings";
import React from "react";

export const QuickChatPanel: React.FC = () => {
  const settings = useSettingsValue();
  const { options, resolveSelectionId } = useChatBackendModelOptions();
  return (
    <QuickChatModelSettings
      defaultModelId={resolveSelectionId(settings.defaultModelKey)}
      options={options}
      onDefaultModelChange={(value) => updateSetting("defaultModelKey", value)}
    >
      <ChatModelEnableList />
    </QuickChatModelSettings>
  );
};

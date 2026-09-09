import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import React from "react";

interface ModelOption {
  label: string;
  value: string;
}

export interface QuickChatModelSettingsProps {
  defaultModelId: string | undefined;
  options: ModelOption[];
  onDefaultModelChange: (modelId: string) => void;
  children: React.ReactNode;
}

/** Model curation shared by desktop and mobile Quick Chat settings. */
export const QuickChatModelSettings: React.FC<QuickChatModelSettingsProps> = ({
  defaultModelId,
  options,
  onDefaultModelChange,
  children,
}) => (
  <SettingSection>
    <div className="tw-flex tw-min-w-0 tw-flex-col tw-py-4">
      <span className="tw-text-base tw-font-semibold">Quick Chat models</span>
      <span className="tw-text-xs tw-text-muted">
        Models shown in the chat model picker. Add providers on the Models (BYOK) tab.
      </span>
    </div>
    <SettingItem
      type="select"
      title="Default model"
      description="The model new chats start with. Pick from your enabled Quick Chat models."
      value={defaultModelId ?? "Select Model"}
      onChange={(value) => {
        if (value === "Select Model") return;
        onDefaultModelChange(value);
      }}
      options={
        defaultModelId !== undefined
          ? options
          : [{ label: "Select Model", value: "Select Model" }, ...options]
      }
      placeholder="Model"
    />
    <div className="tw-py-4">{children}</div>
  </SettingSection>
);

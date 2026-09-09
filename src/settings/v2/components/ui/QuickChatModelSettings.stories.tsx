import { ModelEnableList } from "@/components/ui/ModelEnableList";
import type { Meta, StoryObj } from "@/lib/story";
import { QuickChatModelSettings, type QuickChatModelSettingsProps } from "./QuickChatModelSettings";
import React from "react";

const meta = {
  title: "Settings/Quick Chat models",
  component: QuickChatModelSettings,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<QuickChatModelSettingsProps>;
export default meta;

export const Configured: StoryObj<QuickChatModelSettingsProps> = {
  args: {
    defaultModelId: "gpt-4.1",
    options: [{ label: "GPT-4.1", value: "gpt-4.1" }],
    onDefaultModelChange: () => undefined,
    children: (
      <ModelEnableList
        groups={[
          {
            key: "byok",
            label: "OpenAI",
            badge: "BYOK",
            rows: [
              { id: "gpt-4.1", label: "GPT-4.1", enabled: true },
              { id: "gpt-4.1-mini", label: "GPT-4.1 mini", enabled: false },
            ],
          },
        ]}
        onToggle={() => undefined}
        query=""
        onQueryChange={() => undefined}
        searchPlaceholder="Search chat models…"
      />
    ),
  },
};

export const Empty: StoryObj<QuickChatModelSettingsProps> = {
  args: {
    defaultModelId: undefined,
    options: [],
    onDefaultModelChange: () => undefined,
    children: (
      <ModelEnableList
        groups={[]}
        onToggle={() => undefined}
        query=""
        onQueryChange={() => undefined}
        searchPlaceholder="Search chat models…"
        emptyState={
          <span>
            No models configured yet. Add a provider on the{" "}
            <span className="tw-font-medium">Models (BYOK)</span> tab to populate Quick Chat.
          </span>
        }
      />
    ),
  },
};

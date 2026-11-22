import type { Meta, StoryObj } from "@/lib/story";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { QuickAskFooter, type QuickAskFooterProps } from "./QuickAskFooter";

const MODELS: ModelSelectorEntry[] = [
  {
    name: "claude-sonnet-4-6",
    provider: "anthropic",
    displayName: "anthropic/claude-sonnet-4-6",
    enabled: true,
  },
];

const meta = {
  title: "Quick Ask/Footer",
  component: QuickAskFooter,
  args: {
    models: MODELS,
    selectedModel: "claude-sonnet-4-6|anthropic",
    onSelectModel: () => undefined,
    includeNoteContext: true,
    onIncludeNoteContextChange: () => undefined,
    isStreaming: false,
    canSubmit: true,
    onSubmit: () => undefined,
    onStop: () => undefined,
  },
  parameters: { gallery: { host: "popover", layout: "padded" } },
} satisfies Meta<QuickAskFooterProps>;
export default meta;

export const ReadyToSend: StoryObj<QuickAskFooterProps> = {};

export const NoModelConfigured: StoryObj<QuickAskFooterProps> = {
  args: {
    selectedModel: "__chat_no_models__|",
    models: [
      {
        name: "__chat_no_models__",
        provider: "",
        displayName: "No models — enable in Basic → Agents → Quick Chat",
        enabled: true,
      },
    ],
    canSubmit: false,
  },
};

export const Generating: StoryObj<QuickAskFooterProps> = {
  args: { isStreaming: true, onClear: () => undefined },
};

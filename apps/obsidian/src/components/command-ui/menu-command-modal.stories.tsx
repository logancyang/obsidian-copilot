import type { Meta, StoryObj } from "@/lib/story";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import type { ComponentProps } from "react";
import React from "react";
import { MenuCommandModal } from "./menu-command-modal";

type MenuCommandModalProps = ComponentProps<typeof MenuCommandModal>;

const MODELS: ModelSelectorEntry[] = [
  {
    name: "claude-sonnet-4-6",
    provider: "anthropic",
    displayName: "anthropic/claude-sonnet-4-6",
    enabled: true,
  },
];

const NO_MODELS: ModelSelectorEntry[] = [
  {
    name: "__chat_no_models__",
    provider: "",
    displayName: "No models — enable in Basic → Agents → Quick Chat",
    enabled: true,
  },
];

const RESULT =
  "The quarterly review shows steady growth in every region, led by onboarding and retention gains.";

function InViewport(props: Partial<MenuCommandModalProps>) {
  return (
    <div className="tw-relative tw-h-[520px] tw-w-full tw-transform-gpu tw-overflow-hidden">
      <MenuCommandModal {...(props as MenuCommandModalProps)} />
    </div>
  );
}

const meta = {
  title: "Commands/Quick Command dialog",
  component: MenuCommandModal,
  args: {
    open: true,
    onClose: () => undefined,
    commandIcon: null,
    commandLabel: "Quick Command",
    contentState: { type: "idle" },
    followUpValue: "",
    onFollowUpChange: () => undefined,
    onFollowUpSubmit: () => undefined,
    selectedModel: "claude-sonnet-4-6|anthropic",
    onSelectModel: () => undefined,
    models: MODELS,
    onOpenModelSettings: () => undefined,
    onStop: () => undefined,
    onInsert: () => undefined,
    onReplace: () => undefined,
    initialPosition: { x: 12, y: 12 },
    resizable: true,
    hideContentAreaOnIdle: true,
    includeNoteContext: true,
    onIncludeNoteContextChange: () => undefined,
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<MenuCommandModalProps>;
export default meta;

export const Idle: StoryObj<MenuCommandModalProps> = {
  render: InViewport,
  args: { followUpValue: "Make this more concise" },
};

export const NoModelConfigured: StoryObj<MenuCommandModalProps> = {
  render: InViewport,
  args: { selectedModel: "__chat_no_models__|", models: NO_MODELS, needsModel: true },
};

export const Generating: StoryObj<MenuCommandModalProps> = {
  render: InViewport,
  args: { contentState: { type: "result", text: RESULT.slice(0, 40), isStreaming: true } },
};

export const Result: StoryObj<MenuCommandModalProps> = {
  render: InViewport,
  args: {
    contentState: { type: "result", text: RESULT },
    editableContent: RESULT,
    onEditableContentChange: () => undefined,
    onRunAgain: () => undefined,
    renderMarkdown: async (content: string, el: HTMLElement) => {
      el.setText(content);
    },
  },
};

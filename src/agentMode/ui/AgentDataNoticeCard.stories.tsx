import { AgentDataNoticeCard } from "@/agentMode/ui/AgentDataNoticeCard";
import type { Meta, StoryObj } from "@/lib/story";
import type * as React from "react";

type AgentDataNoticeCardProps = React.ComponentProps<typeof AgentDataNoticeCard>;

const meta = {
  title: "Agent Mode/Agent Data Notice Card",
  component: AgentDataNoticeCard,
  args: {
    backendName: "opencode",
    modelName: "Claude Sonnet 4.5",
    destination: "Anthropic",
    onContinue: () => undefined,
    onCancel: () => undefined,
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentDataNoticeCardProps>;
export default meta;

export const Default: StoryObj<AgentDataNoticeCardProps> = {};

export const CustomEndpoint: StoryObj<AgentDataNoticeCardProps> = {
  args: { modelName: "qwen3-coder", destination: "LM Studio (http://localhost:1234/v1)" },
};

export const CliOwnedEndpoint: StoryObj<AgentDataNoticeCardProps> = {
  args: {
    backendName: "Codex",
    modelName: "GPT-5.5",
    destination: "The endpoint the Codex CLI is set to use",
  },
};

export const ModelsLoading: StoryObj<AgentDataNoticeCardProps> = {
  args: {
    modelName: "Loading models…",
    destination: "The endpoint the opencode CLI is set to use",
    continueDisabled: true,
  },
};

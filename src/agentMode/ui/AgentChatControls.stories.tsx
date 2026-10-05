import type { Meta, StoryObj } from "@/lib/story";
import React from "react";
import { AgentChatControls } from "./AgentChatControls";

type ControlsProps = React.ComponentProps<typeof AgentChatControls>;

const noop = () => {};

const meta = {
  title: "Agent Mode/Agent Chat Controls",
  component: AgentChatControls,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: { onNewChat: noop, onCopyChatLink: noop },
} satisfies Meta<ControlsProps>;
export default meta;

export const WithAgentScratchpad: StoryObj<ControlsProps> = {
  name: "Chat with a custom agent — scratchpad beside New Chat",
  args: { scratchpad: { agentName: "Venkat", onOpen: noop } },
};

export const CopilotChat: StoryObj<ControlsProps> = {
  name: "Chat with Copilot — no scratchpad",
  args: {},
};

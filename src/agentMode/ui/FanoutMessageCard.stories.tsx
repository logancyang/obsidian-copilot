import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { FanoutMessageCard } from "@/agentMode/ui/FanoutMessageCard";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type FanoutMessageCardProps = React.ComponentProps<typeof FanoutMessageCard>;

const MESSAGE: AgentChatMessage = {
  id: "fanout-reply",
  sender: "ai",
  message: "",
  timestamp: { epoch: 0, display: "2026/11/11 10:02:11", fileName: "" },
  isVisible: true,
};

const TURN: FanoutTurn = {
  answers: {
    claude: {
      backendId: "claude",
      status: "done",
      text: "The hotel near the station is cheapest and has free cancellation.",
    },
    codex: {
      backendId: "codex",
      status: "done",
      text: "The station hotel wins on price; the harbor hotel has the better view.",
    },
  },
  summary: {
    status: "done",
    text: "Both agents pick the hotel near the station for its price and free cancellation.",
  },
};

const meta = {
  title: "Agent Mode/Fanout Message Card",
  component: FanoutMessageCard,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<FanoutMessageCardProps>;
export default meta;

const CardDemo: React.FC<{ canContinue: boolean }> = ({ canContinue }) => (
  <TooltipProvider>
    <FanoutMessageCard
      message={MESSAGE}
      turn={TURN}
      app={useApp()}
      onContinue={canContinue ? () => {} : undefined}
    />
  </TooltipProvider>
);

export const IdleChat: StoryObj<FanoutMessageCardProps> = {
  render: () => <CardDemo canContinue />,
};

export const ChatGenerating: StoryObj<FanoutMessageCardProps> = {
  render: () => <CardDemo canContinue={false} />,
};

import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type {
  AgentChatMessage,
  AskUserQuestionPrompt,
  PermissionPrompt,
  SessionId,
} from "@/agentMode/session/types";
import AgentChatMessages from "@/agentMode/ui/AgentChatMessages";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type AgentChatMessagesProps = React.ComponentProps<typeof AgentChatMessages>;

const SESSION_ID = "gallery-session" as SessionId;
const chatBackend = {
  resolveToolPermission: () => undefined,
  resolveAskUserQuestion: () => undefined,
} as unknown as AgentChatBackend;

const message: AgentChatMessage = {
  id: "gallery-response",
  sender: "ai",
  message: "I need a few decisions before I can continue.",
  timestamp: { epoch: Date.now(), display: "", fileName: "" },
  isVisible: true,
};

function permission(id: string, order: number, title: string): PermissionPrompt {
  return {
    sessionId: SESSION_ID,
    pendingActionOrder: order,
    toolCall: { toolCallId: id, status: "pending", title },
    options: [
      { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
      { optionId: "reject_once", name: "Deny once", kind: "reject_once" },
    ],
  };
}

function question(id: string, order: number, text: string): AskUserQuestionPrompt {
  return {
    sessionId: SESSION_ID,
    requestId: id,
    pendingActionOrder: order,
    questions: [{ question: text, options: [{ label: "Yes" }, { label: "No" }] }],
  };
}

const permissions = [
  permission("read-roadmap", 0, "Read roadmap.md"),
  permission("edit-brief", 2, "Edit launch brief.md"),
  permission("run-checks", 4, "Run validation checks"),
];
const questions = [
  question("audience", 1, "Should the brief target existing customers?"),
  question("publish", 3, "Should I prepare a publish-ready version?"),
];

const ActionRailDemo: React.FC<AgentChatMessagesProps> = (props) => {
  const app = useApp();
  return (
    <TooltipProvider>
      <div className="tw-h-96 tw-overflow-hidden tw-border tw-border-solid tw-border-border">
        <AgentChatMessages {...props} app={app} />
      </div>
    </TooltipProvider>
  );
};

const actionRailArgs: AgentChatMessagesProps = {
  messages: [message],
  app: {} as AgentChatMessagesProps["app"],
  currentPlan: null,
  pendingToolPermissions: permissions,
  pendingAskUserQuestions: questions,
  chatBackend,
  isLoading: true,
};

const meta = {
  title: "Agent Mode/Agent Chat Messages",
  component: AgentChatMessages,
  args: actionRailArgs,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentChatMessagesProps>;
export default meta;

/** Blocking actions stay visible above the controls and scroll independently from the transcript. */
export const PendingActionsOverflow: StoryObj<AgentChatMessagesProps> = {
  render: () => <ActionRailDemo {...actionRailArgs} />,
};

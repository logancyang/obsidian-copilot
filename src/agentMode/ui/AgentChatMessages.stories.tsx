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
import React, { useMemo, useState } from "react";

type AgentChatMessagesProps = React.ComponentProps<typeof AgentChatMessages>;

const SESSION_ID = "gallery-session" as SessionId;
const message: AgentChatMessage = {
  id: "gallery-response",
  sender: "ai",
  message: "I need a few decisions before I can continue.",
  timestamp: { epoch: Date.now(), display: "", fileName: "" },
  isVisible: true,
};

function permission(id: string, title: string): PermissionPrompt {
  return {
    sessionId: SESSION_ID,
    toolCall: { toolCallId: id, status: "pending", title },
    options: [
      { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
      { optionId: "reject_once", name: "Deny once", kind: "reject_once" },
    ],
  };
}

function question(id: string, text: string): AskUserQuestionPrompt {
  return {
    sessionId: SESSION_ID,
    requestId: id,
    questions: [{ question: text, options: [{ label: "Yes" }, { label: "No" }] }],
  };
}

const permissions = [
  permission("read-roadmap", "Read roadmap.md"),
  permission("edit-brief", "Edit launch brief.md"),
  permission("run-checks", "Run validation checks"),
];
const questions = [
  question("audience", "Should the brief target existing customers?"),
  question("publish", "Should I prepare a publish-ready version?"),
];
const tallQuestion: AskUserQuestionPrompt = {
  sessionId: SESSION_ID,
  requestId: "deployment-strategy",
  questions: [
    {
      question: "Which deployment strategy should I use for the staged rollout?",
      options: Array.from({ length: 8 }, (_, index) => ({
        label: `Strategy ${index + 1}: staged rollout with regional validation`,
        description:
          "Validate telemetry, rollback readiness, and user impact before expanding to the next region.",
      })),
    },
  ],
};

const QueuedActionsDemo: React.FC<AgentChatMessagesProps> = (props) => {
  const app = useApp();
  const [pendingToolPermissions, setPendingToolPermissions] = useState(
    props.pendingToolPermissions
  );
  const [pendingAskUserQuestions, setPendingAskUserQuestions] = useState(
    props.pendingAskUserQuestions
  );
  const chatBackend = useMemo(
    () =>
      ({
        resolveToolPermission: (toolCallId: string) => {
          setPendingToolPermissions((current) =>
            current.filter((request) => request.toolCall.toolCallId !== toolCallId)
          );
        },
        resolveAskUserQuestion: (requestId: string) => {
          setPendingAskUserQuestions((current) =>
            current.filter((request) => request.requestId !== requestId)
          );
        },
      }) as unknown as AgentChatBackend,
    []
  );

  return (
    <TooltipProvider>
      <div className="tw-h-96 tw-overflow-hidden">
        <AgentChatMessages
          {...props}
          app={app}
          pendingToolPermissions={pendingToolPermissions}
          pendingAskUserQuestions={pendingAskUserQuestions}
          chatBackend={chatBackend}
        />
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
  chatBackend: {} as AgentChatBackend,
  streamingMessageId: message.id,
};

const meta = {
  title: "Agent Mode/Agent Chat Messages",
  component: AgentChatMessages,
  args: actionRailArgs,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentChatMessagesProps>;
export default meta;

/** Resolve questions first, then each full-width permission in queue order. */
export const QueuedActions: StoryObj<AgentChatMessagesProps> = {
  render: () => <QueuedActionsDemo {...actionRailArgs} />,
};

/** A verbose blocking question remains resolvable when the chat pane is shorter than the card. */
export const TallQuestion: StoryObj<AgentChatMessagesProps> = {
  render: () => (
    <QueuedActionsDemo
      {...actionRailArgs}
      pendingToolPermissions={[]}
      pendingAskUserQuestions={[tallQuestion]}
    />
  ),
};

/** A new turn keeps its running indicator after the preceding turn was stopped. */
export const RunningAfterStop: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: [
      { ...message, id: "first-request", sender: "user", message: "Summarize this note." },
      {
        ...message,
        id: "stopped-response",
        message: "I will read the note and summarize its main points.",
        turnStopReason: "cancelled",
        turnDurationMs: 2300,
      },
      { ...message, id: "next-request", sender: "user", message: "List its action items instead." },
      { ...message, id: "running-response", message: "" },
    ],
    streamingMessageId: "running-response",
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

/** A hand-edited note reloads as readable text with its structured voice history flagged. */
export const StructuredHistoryUnavailable: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: [
      {
        ...message,
        id: "spoken-request",
        sender: "user",
        message: "What did we decide on Tuesday?",
      },
      {
        ...message,
        id: "voice-task-summary",
        message: "_Voice task — completed_\n\nThe team agreed to ship the rollout in two stages.",
      },
    ],
    streamingMessageId: null,
    historyRestoreStatus: "unavailable",
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

/** A chat written by a newer Copilot opens read-only rather than being rewritten. */
export const StructuredHistoryFromNewerVersion: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: [{ ...message, id: "future-answer", message: "Saved by a newer build." }],
    streamingMessageId: null,
    historyRestoreStatus: "unsupported-schema",
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

const spokenRequest: AgentChatMessage = {
  ...message,
  id: "voice-user",
  sender: "user",
  origin: "voice-user",
  message: "Find my launch risks.",
};
const speechReply: AgentChatMessage = {
  ...message,
  id: "voice-assistant",
  origin: "voice-assistant",
  message: "I'll check the launch notes while we talk.",
};
const taskAnswer: AgentChatMessage = {
  ...message,
  id: "voice-answer",
  taskId: "voice-task",
  presentation: "task-detail",
  message:
    "The launch review identifies onboarding as the main risk. See [[Launch review]] for the full customer feedback.",
};

/** Speech stays public while exact backend output remains in its linked task card. */
export const MixedVoiceConversation: StoryObj<AgentChatMessagesProps> = {
  render: function MixedVoiceDemo(props) {
    const app = useApp();
    const task = {
      taskId: "voice-task",
      sourceMessageIds: [spokenRequest.id],
      delegationIds: [],
      assistantMessageId: taskAnswer.id,
      state:
        props.streamingMessageId === taskAnswer.id ? ("running" as const) : ("completed" as const),
      presentation: "voice-card" as const,
    };
    const chatBackend = {
      getTaskDetails: () => ({ task, messages: [taskAnswer], activityAvailable: true }),
    } as unknown as AgentChatBackend;
    return (
      <TooltipProvider>
        <div className="tw-h-96 tw-overflow-hidden">
          <AgentChatMessages
            {...actionRailArgs}
            app={app}
            messages={[spokenRequest, speechReply, taskAnswer]}
            conversationRows={[
              { kind: "message", message: spokenRequest },
              { kind: "message", message: speechReply },
              { kind: "task-card", task },
            ]}
            backendDisplayName="Codex"
            chatBackend={chatBackend}
            streamingMessageId={null}
            pendingToolPermissions={[]}
            pendingAskUserQuestions={[]}
          />
        </div>
      </TooltipProvider>
    );
  },
};

/** Ending voice leaves accepted backend work visible and running in its original card. */
export const TaskContinuesAfterVoiceEnds: StoryObj<AgentChatMessagesProps> = {
  ...MixedVoiceConversation,
  args: { ...actionRailArgs, streamingMessageId: taskAnswer.id },
};

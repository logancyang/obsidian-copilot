import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type {
  AgentChatMessage,
  AskUserQuestionPrompt,
  PermissionPrompt,
  SessionId,
} from "@/agentMode/session/types";
import AgentChatMessages from "@/agentMode/ui/AgentChatMessages";
import type { ChatStates } from "@/agentMode/session/chatExtension";
import type { FeedbackOffer } from "@/agentMode/session/feedback/feedbackOffer";
import { relayedReply } from "@/agents/agentMode/ui/testing/relayedReply";
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

const NO_CHAT_STATES: ChatStates = new Map();

function chatStatesWithOffer(offer: FeedbackOffer): ChatStates {
  return new Map([["feedback-offer", offer]]);
}

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
          plugin={{ ...props.plugin, app } as AgentChatMessagesProps["plugin"]}
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
  plugin: { manifest: { version: "4.1.0" } } as AgentChatMessagesProps["plugin"],
  currentPlan: null,
  pendingToolPermissions: permissions,
  pendingAskUserQuestions: questions,
  chatBackend: {} as AgentChatBackend,
  isLoading: true,
  chatStates: NO_CHAT_STATES,
};

const meta = {
  title: "Agent Mode/Agent Chat Messages",
  component: AgentChatMessages,
  args: actionRailArgs,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentChatMessagesProps>;
export default meta;

export const QueuedActions: StoryObj<AgentChatMessagesProps> = {
  render: () => <QueuedActionsDemo {...actionRailArgs} />,
};

export const LongResponse: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    currentPlan: null,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: [
      { ...message, id: "long-request", sender: "user", message: "Review the project notes." },
      {
        ...message,
        id: "long-response",
        message: Array.from(
          { length: 12 },
          (_, index) => `Finding ${index + 1}: The notes clarify the next step for the project.`
        ).join("\n\n"),
      },
    ],
    isLoading: true,
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

export const TallQuestion: StoryObj<AgentChatMessagesProps> = {
  render: () => (
    <QueuedActionsDemo
      {...actionRailArgs}
      pendingToolPermissions={[]}
      pendingAskUserQuestions={[tallQuestion]}
    />
  ),
};

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
    isLoading: true,
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

export const StoppedCommand: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: [
      {
        ...message,
        id: "slow-request",
        sender: "user",
        message: "Rebuild the index of every note.",
      },
      {
        ...message,
        id: "stopped-command",
        message: "",
        turnStopReason: "cancelled",
        turnDurationMs: 4100,
        parts: [
          {
            kind: "tool_call",
            id: "list-notes",
            title: "Run ls notes",
            status: "completed",
            vendorToolName: "Bash",
            input: { command: "ls notes" },
          },
          {
            kind: "tool_call",
            id: "rebuild",
            title: "Run ./rebuild-index.sh",
            status: "cancelled",
            vendorToolName: "Bash",
            input: { command: "./rebuild-index.sh" },
          },
        ],
      },
    ],
    isLoading: false,
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

export const AgentStoppedAfterDeclinedPermission: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: [
      {
        ...message,
        id: "hardware-request",
        sender: "user",
        message: "Save this Mac's hardware info to hardware.txt.",
      },
      {
        ...message,
        id: "declined-command",
        message: "",
        turnStopReason: "cancelled",
        agentCancelCause: "permission_declined",
        turnDurationMs: 24000,
        parts: [
          { kind: "text", text: "I'll ask for approval to write the report in the vault." },
          {
            kind: "tool_call",
            id: "hardware-report",
            title: "Run system_profiler SPHardwareDataType > hardware.txt",
            status: "failed",
            vendorToolName: "Bash",
            input: { command: "system_profiler SPHardwareDataType > hardware.txt" },
          },
        ],
      },
    ],
    isLoading: false,
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

export const AgentStoppedBeforeReplying: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: [
      {
        ...message,
        id: "summary-request",
        sender: "user",
        message: "Summarize this week's meeting notes.",
      },
      {
        ...message,
        id: "empty-cancelled-reply",
        message: "",
        turnStopReason: "cancelled",
        agentCancelCause: "unspecified",
        turnDurationMs: 3000,
      },
    ],
    isLoading: false,
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

export const FinishedReplyWhileSubagentsRun: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: [
      {
        ...message,
        id: "launch-request",
        sender: "user",
        message: "Research both vendors in parallel and compare them when you're done.",
      },
      {
        ...message,
        id: "launch-reply",
        message:
          "I started two subagents, one per vendor. I'll compare them once both report back.",
        turnStopReason: "end_turn",
        turnDurationMs: 13_000,
      },
    ],
    isLoading: true,
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

export const MessageDeliveredMidTurn: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: [
      {
        ...message,
        id: "long-request",
        sender: "user",
        message: "Write a one-line summary of each note in the vault.",
      },
      {
        ...message,
        id: "before-steer",
        message: "Alpha: launch checklist for the spring release.",
        turnStopReason: "end_turn",
        turnDurationMs: 8200,
      },
      {
        ...message,
        id: "steer",
        sender: "user",
        message: "Only do the first two notes.",
      },
      { ...message, id: "after-steer", message: "Beta: notes from the design review." },
    ],
    isLoading: true,
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

export const ApprovedPlanRunning: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    currentPlan: null,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: [
      { ...message, id: "plan-request", sender: "user", message: "Plan a note for my trip." },
      {
        ...message,
        id: "plan-implementation",
        message: "The plan is approved. I'm creating the note now.",
      },
    ],
    isLoading: true,
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

export const PlanResponses: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    currentPlan: null,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: [
      { ...message, id: "request", sender: "user", message: "Plan my trip." },
      {
        ...message,
        id: "responses",
        message: "",
        parts: [
          {
            kind: "tool_call",
            id: "answer",
            title: "Answered: Checklist",
            status: "completed",
            userResponse: "Answered: Checklist",
            output: [{ type: "text", text: "Choose a format: Checklist" }],
          },
          {
            kind: "tool_call",
            id: "plan-approval",
            title: "Approved plan",
            status: "completed",
            toolKind: "switch_mode",
            userResponse: "Approved plan",
          },
        ],
      },
    ],
    isLoading: false,
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

export const FeedbackAfterFileChanges: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: [
      { ...message, id: "edit-request", sender: "user", message: "Tidy the launch brief." },
      {
        ...message,
        id: "edit-response",
        message: "",
        turnDurationMs: 14_000,
        turnStopReason: "end_turn",
        parts: [
          {
            kind: "tool_call",
            id: "edit-brief",
            title: "Edit launch brief.md",
            status: "completed",
            vendorToolName: "Edit",
            input: { file_path: "Projects/launch brief.md" },
          },
          { kind: "text", text: "Tightened the intro and fixed the headings." },
        ],
        fileChanges: [
          {
            path: "Projects/launch brief.md",
            status: "modified",
            before: "before\n",
            after: "after\n",
            additions: 6,
            deletions: 9,
          },
        ],
      },
      {
        ...message,
        id: "complaint",
        sender: "user",
        message: "Why did you delete my whole second section? I only asked you to tidy it.",
      },
      {
        ...message,
        id: "apology",
        message: "",
        turnDurationMs: 9_000,
        turnStopReason: "end_turn",
        parts: [
          {
            kind: "tool_call",
            id: "restore-brief",
            title: "Edit launch brief.md",
            status: "completed",
            vendorToolName: "Edit",
            input: { file_path: "Projects/launch brief.md" },
          },
          { kind: "text", text: "Sorry, I removed it by mistake. The second section is back." },
        ],
        fileChanges: [
          {
            path: "Projects/launch brief.md",
            status: "modified",
            before: "before\n",
            after: "after\n",
            additions: 14,
            deletions: 0,
          },
        ],
      },
    ],
    chatStates: chatStatesWithOffer({
      trigger: "agent",
      draft: {
        title: "Deleted a section when asked to tidy a note",
        whatHappened: "Asked to tidy a note, the agent removed its whole second section.",
        userSaid: "Why did you delete my whole second section? I only asked you to tidy it.",
        repro: "1. Ask the agent to tidy a note with several sections. 2. Compare the result.",
      },
      evidence: {
        backendId: "claude",
        model: "claude-opus-5-5",
        sessionId: "gallery-session",
        raisedAt: "2026-10-12T17:00:00.000Z",
      },
      afterUserMessageId: "complaint",
      status: "open",
    }),
    isLoading: false,
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

function sentDaysAgo(days: number, hour: number, minute: number): AgentChatMessage["timestamp"] {
  const now = new Date();
  const epoch = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - days,
    hour,
    minute
  ).getTime();
  return { epoch, display: "", fileName: "" };
}

export const SpansTwoDays: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: [
      {
        ...message,
        id: "recap-request",
        sender: "user",
        message: "Draft the Q4 recap from this week's notes.",
        timestamp: sentDaysAgo(1, 14, 2),
      },
      {
        ...message,
        id: "recap-reply",
        message: "",
        timestamp: sentDaysAgo(1, 14, 3),
        turnStopReason: "end_turn",
        parts: [{ kind: "text", text: "The draft is in Q4 recap, with the three decisions." }],
      },
      {
        ...message,
        id: "trim-request",
        sender: "user",
        message: "Cut the summary down to three bullets.",
        timestamp: sentDaysAgo(0, 9, 15),
      },
      {
        ...message,
        id: "trim-reply",
        message: "",
        timestamp: sentDaysAgo(0, 9, 16),
        turnDurationMs: 18_000,
        turnStopReason: "end_turn",
        parts: [{ kind: "text", text: "Done. The summary is now three bullets." }],
      },
    ],
    isLoading: false,
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

const askedMaya: AgentChatMessage[] = [
  {
    ...message,
    id: "ask-maya",
    sender: "user",
    message: "Draft the Q4 recap from this week's notes, then ask @Maya to check the citations.",
    timestamp: sentDaysAgo(0, 14, 2),
  },
  {
    ...message,
    id: "asked-maya-reply",
    message: "",
    timestamp: sentDaysAgo(0, 14, 2),
    turnDurationMs: 46_000,
    turnStopReason: "end_turn",
    parts: [
      {
        kind: "text",
        text: "The draft is in Q4 recap. I asked Maya to check its three citations and will pass on what she finds.",
      },
    ],
  },
];

export const OneReply: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: askedMaya,
    isLoading: false,
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

export const GrewAfterAnotherAgent: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: [
      ...askedMaya,
      {
        ...message,
        id: "maya-relay",
        sender: "user",
        message: relayedReply("Maya", "One wrong year: Thinking, Fast and Slow is 2011, not 2012."),
        timestamp: sentDaysAgo(0, 14, 4),
      },
      {
        ...message,
        id: "passed-on-reply",
        message: "",
        timestamp: sentDaysAgo(0, 14, 4),
        turnDurationMs: 12_000,
        turnStopReason: "end_turn",
        parts: [
          {
            kind: "text",
            text: "Maya found one wrong year: Thinking, Fast and Slow is 2011, not 2012. I fixed it in the recap.",
          },
        ],
      },
    ],
    isLoading: false,
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

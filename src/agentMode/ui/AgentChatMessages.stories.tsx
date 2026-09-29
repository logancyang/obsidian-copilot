import type { WireMessage, WireQuestionPrompt } from "@/agentMode/protocol/state";
import type { PermissionPrompt, SessionId } from "@/agentMode/session/types";
import AgentChatMessages from "@/agentMode/ui/AgentChatMessages";
import { AgentPaneCapabilitiesProvider } from "@/agentMode/ui/AgentPaneContext";
import { createFixtureClient, inertPaneCapabilities } from "@/agentMode/ui/agentPane.fixtures";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useMemo } from "react";

type AgentChatMessagesProps = React.ComponentProps<typeof AgentChatMessages>;

const SESSION_ID = "gallery-session" as SessionId;
const message: WireMessage = {
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

function question(id: string, text: string): WireQuestionPrompt {
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
const tallQuestion: WireQuestionPrompt = {
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

interface PaneScenario {
  messages: WireMessage[];
  pendingToolPermissions: PermissionPrompt[];
  pendingAskUserQuestions: WireQuestionPrompt[];
  isLoading: boolean;
}

const ActionsDemo: React.FC<{ scenario: PaneScenario }> = ({ scenario }) => {
  const app = useApp();
  const fixture = useMemo(
    () =>
      createFixtureClient({
        sessionId: SESSION_ID,
        tab: { status: scenario.isLoading ? "running" : "idle" },
        session: {
          transcript: scenario.messages,
          pending: {
            permissions: scenario.pendingToolPermissions,
            questions: scenario.pendingAskUserQuestions,
            planPermission: false,
          },
        },
        onCommand: (command, host) => {
          const { pending } = host.getSession();
          if (command.name === "resolvePermission") {
            host.emitSession({
              t: "slice",
              key: "pending",
              value: {
                ...pending,
                permissions: pending.permissions.filter(
                  (request) => request.toolCall.toolCallId !== command.toolCallId
                ),
              },
            });
          } else if (command.name === "answerQuestion") {
            host.emitSession({
              t: "slice",
              key: "pending",
              value: {
                ...pending,
                questions: pending.questions.filter(
                  (request) => request.requestId !== command.requestId
                ),
              },
            });
          }
          return { ok: true, value: undefined };
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a story renders one scenario for its lifetime
    []
  );

  return (
    <TooltipProvider>
      <AgentPaneCapabilitiesProvider value={inertPaneCapabilities}>
        <div className="tw-h-96 tw-overflow-hidden">
          <AgentChatMessages
            client={fixture.client}
            sessionId={SESSION_ID}
            app={app}
            isLoading={scenario.isLoading}
          />
        </div>
      </AgentPaneCapabilitiesProvider>
    </TooltipProvider>
  );
};

const baseScenario: PaneScenario = {
  messages: [message],
  pendingToolPermissions: permissions,
  pendingAskUserQuestions: questions,
  isLoading: true,
};

const scenarioStory = (overrides: Partial<PaneScenario>): StoryObj<AgentChatMessagesProps> => ({
  render: () => <ActionsDemo scenario={{ ...baseScenario, ...overrides }} />,
});

const meta = {
  title: "Agent Mode/Agent Chat Messages",
  component: AgentChatMessages,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentChatMessagesProps>;
export default meta;

export const QueuedActions: StoryObj<AgentChatMessagesProps> = scenarioStory({});

export const LongResponse: StoryObj<AgentChatMessagesProps> = scenarioStory({
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
});

export const TallQuestion: StoryObj<AgentChatMessagesProps> = scenarioStory({
  pendingToolPermissions: [],
  pendingAskUserQuestions: [tallQuestion],
});

export const RunningAfterStop: StoryObj<AgentChatMessagesProps> = scenarioStory({
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
});

export const ApprovedPlanRunning: StoryObj<AgentChatMessagesProps> = scenarioStory({
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
});

export const PlanResponses: StoryObj<AgentChatMessagesProps> = scenarioStory({
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
});

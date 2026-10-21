import type { AgentChatMessage } from "@/agentMode/session/types";
import { TaskOutputReaderContext } from "@/agentMode/ui/hooks/useTaskOutputTail";
import { COMMAND_OUTPUT_MAX_BYTES, TaskDetailView } from "@/agentMode/ui/TaskDetailView";
import { makeCommandTask, makeTask, textOutputReader } from "@/agentMode/ui/testing/taskFixtures";
import { AppContext } from "@/context";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/components/chat-components/ChatSingleMessage", () => ({
  __esModule: true,
  default: ({ message }: { message: { sender: string; message: string } }) => (
    <div data-testid={`message-${message.sender}`}>{message.message}</div>
  ),
}));

jest.mock("@/agentMode/ui/AgentTrailView", () => ({
  AgentTrail: ({
    parts,
    isStreaming,
  }: {
    parts: Array<{ kind: string; title?: string; text?: string }>;
    isStreaming: boolean;
  }) => (
    <div data-testid="trail" data-streaming={String(isStreaming)}>
      {parts.map((p) => p.title ?? p.text).join(" | ")}
    </div>
  ),
}));

const ISSUE_749 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/749";
const OUTPUT = "/tmp/tasks/task-2.output";

const SUBAGENT_MESSAGES: AgentChatMessage[] = [
  {
    id: "m1",
    sender: "ai",
    timestamp: null,
    isVisible: true,
    message: "",
    parts: [
      { kind: "tool_call", id: "t1", title: "Bash: wc -w Welcome.md", status: "completed" },
      { kind: "text", text: "Welcome.md has 9 words." },
    ],
  },
];

function renderDetail(
  props: Partial<React.ComponentProps<typeof TaskDetailView>>,
  files: Record<string, string> = {}
) {
  const onBack = jest.fn();
  const app = {} as never;
  render(
    <AppContext.Provider value={app}>
      <TaskOutputReaderContext.Provider value={textOutputReader(files)}>
        <TaskDetailView task={makeTask()} messages={[]} app={app} onBack={onBack} {...props} />
      </TaskOutputReaderContext.Provider>
    </AppContext.Provider>
  );
  return { onBack };
}

describe("TaskDetailView", () => {
  it(`shows a subagent's title and model, its task as the first user message, then its work, live while it runs (${ISSUE_749})`, () => {
    renderDetail({
      task: makeTask({ prompt: "Count the words in Welcome.md", model: "claude-haiku-9" }),
      messages: SUBAGENT_MESSAGES,
    });

    expect(screen.getByText("Count words in Welcome")).toBeTruthy();
    expect(screen.getByText("general-purpose · claude-haiku-9")).toBeTruthy();
    expect(screen.getByTestId("message-user").textContent).toBe("Count the words in Welcome.md");
    expect(screen.getByTestId("trail").textContent).toBe(
      "Bash: wc -w Welcome.md | Welcome.md has 9 words."
    );
    expect(screen.getByTestId("trail").getAttribute("data-streaming")).toBe("true");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it(`stays open when its subagent ends and shows the final status (${ISSUE_749})`, () => {
    renderDetail({ task: makeTask({ status: "completed" }), messages: SUBAGENT_MESSAGES });

    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getByTestId("trail").getAttribute("data-streaming")).toBe("false");
  });

  it("says a subagent is starting before it has done anything", () => {
    renderDetail({ task: makeTask() });

    expect(screen.getByText("Starting…")).toBeTruthy();
  });

  it(`shows a command and its output read from its output file (${ISSUE_749})`, async () => {
    renderDetail({ task: makeCommandTask() }, { [OUTPUT]: "line 1\nline 2\n" });

    expect(screen.getByText("Background command")).toBeTruthy();
    expect(screen.getByText(/\$ for i in/)).toBeTruthy();
    await screen.findByText(/line 2/);
    expect(screen.getByLabelText("Command output").textContent).toBe("line 1\nline 2\n");
    expect(screen.queryByText(/Showing the last/)).toBeNull();
  });

  it(`notes when a long command output is cut to its newest part (${ISSUE_749})`, async () => {
    const long = "x".repeat(100) + "\n";
    renderDetail(
      { task: makeCommandTask({ status: "completed" }) },
      { [OUTPUT]: long.repeat(Math.ceil(COMMAND_OUTPUT_MAX_BYTES / long.length) + 10) }
    );

    expect(await screen.findByText("Showing the last 256 KB of output.")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
  });

  it("returns to the chat from its back button", () => {
    const { onBack } = renderDetail({});

    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));

    expect(onBack).toHaveBeenCalled();
  });
});

import type { PermissionPrompt } from "@/agentMode/session/types";
import {
  TASK_OUTPUT_POLL_MS,
  TaskOutputReaderContext,
} from "@/agentMode/ui/hooks/useTaskOutputTail";
import {
  RunningTasksIndicator,
  STOP_UNAVAILABLE_UNTIL_STARTED,
} from "@/agentMode/ui/RunningTasksIndicator";
import { makeCommandTask, makeTask, textOutputReader } from "@/agentMode/ui/testing/taskFixtures";
import { TooltipProvider } from "@/components/ui/tooltip";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const ISSUE_749 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/749";
const ISSUE_748 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/748";
const OUTPUT = "/tmp/tasks/task-2.output";

function renderIndicator(
  props: Partial<React.ComponentProps<typeof RunningTasksIndicator>>,
  files: Record<string, string> = {}
) {
  const onOpenTask = jest.fn();
  const createReader = textOutputReader(files);
  const element = (next: Partial<React.ComponentProps<typeof RunningTasksIndicator>>) => (
    <TooltipProvider>
      <TaskOutputReaderContext.Provider value={createReader}>
        <RunningTasksIndicator
          tasks={[makeTask(), makeCommandTask()]}
          permissions={[]}
          onOpenTask={onOpenTask}
          {...next}
        />
      </TaskOutputReaderContext.Provider>
    </TooltipProvider>
  );
  const result = render(element(props));
  return {
    ...result,
    onOpenTask,
    rerenderWith: (next: typeof props) => result.rerender(element(next)),
  };
}

describe("RunningTasksIndicator", () => {
  beforeEach(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = window.document;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it(`counts running subagents and background commands, and shows nothing once none runs (${ISSUE_749})`, () => {
    const { rerenderWith, container } = renderIndicator({});

    expect(screen.getByRole("button", { name: "2 tasks running" })).toBeTruthy();

    rerenderWith({ tasks: [makeTask({ status: "completed" })] });

    expect(container.textContent).toBe("");
  });

  it(`keeps its list closed when tasks run again after the last one ended while the list was open (${ISSUE_749})`, () => {
    const { rerenderWith } = renderIndicator({});
    fireEvent.pointerEnter(screen.getByRole("button", { name: "2 tasks running" }));
    expect(screen.getByText("Print 30 progress lines")).toBeTruthy();

    rerenderWith({ tasks: [] });
    rerenderWith({ tasks: [makeCommandTask({ taskId: "task-3" })] });

    expect(screen.getByRole("button", { name: "1 task running" })).toBeTruthy();
    expect(screen.queryByText("Print 30 progress lines")).toBeNull();
  });

  it(`opens on hover with one row per running task, each saying it runs only to screen readers beside its spinner (${ISSUE_749})`, async () => {
    renderIndicator({ permissions: [] }, { [OUTPUT]: "line 1\n" });

    fireEvent.pointerEnter(screen.getByRole("button", { name: "2 tasks running" }));

    expect(screen.getByText("general-purpose · Count words in Welcome")).toBeTruthy();
    expect(screen.getByText("Print 30 progress lines")).toBeTruthy();
    expect(
      screen.getAllByText("Running").map((label) => label.classList.contains("tw-sr-only"))
    ).toEqual([true, true]);
    expect(await screen.findByText("line 1")).toBeTruthy();
  });

  it(`shows a subagent waiting on its permission request as needing approval, in words since it shares the running spinner (${ISSUE_749})`, () => {
    const permission: PermissionPrompt = {
      sessionId: "s",
      requester: { taskId: "task-1" },
      toolCall: { toolCallId: "p1", title: "Bash" },
      options: [],
    };
    renderIndicator({ defaultOpen: true, permissions: [permission] });

    expect(screen.getByText("Needs approval").classList.contains("tw-sr-only")).toBe(false);
  });

  it(`follows a command's output file so its row shows the latest line (${ISSUE_749})`, async () => {
    jest.useFakeTimers();
    const files = { [OUTPUT]: "line 1\n" };
    renderIndicator({ defaultOpen: true }, files);
    expect(await screen.findByText("line 1")).toBeTruthy();

    files[OUTPUT] += "line 2\n";
    await act(() => jest.advanceTimersByTimeAsync(TASK_OUTPUT_POLL_MS));

    expect(screen.getByText("line 2")).toBeTruthy();
    expect(screen.queryByText("line 1")).toBeNull();
  });

  it("says a command has no output yet before its file has any", () => {
    renderIndicator({ defaultOpen: true, tasks: [makeCommandTask({ outputFile: undefined })] });

    expect(screen.getByText("No output yet")).toBeTruthy();
  });

  it(`removes a task's row the moment it ends (${ISSUE_749})`, () => {
    const { rerenderWith } = renderIndicator({ defaultOpen: true });

    rerenderWith({ tasks: [makeTask(), makeCommandTask({ status: "completed" })] });

    expect(screen.getByRole("button", { name: "1 task running" })).toBeTruthy();
    expect(screen.queryByText("Print 30 progress lines")).toBeNull();
  });

  it(`opens a task's view when its row is clicked (${ISSUE_749})`, () => {
    const { onOpenTask } = renderIndicator({ defaultOpen: true });

    fireEvent.click(screen.getByText("Print 30 progress lines"));

    expect(onOpenTask).toHaveBeenCalledWith("call-2");
  });

  it(`gives every running subagent and command row a stop control that stops that task without opening it (${ISSUE_748})`, () => {
    const onStopTask = jest.fn();
    const { onOpenTask } = renderIndicator({ defaultOpen: true, onStopTask });
    const stops = screen.getAllByRole("button", { name: "Stop task" });

    fireEvent.click(stops[1]);

    expect(stops).toHaveLength(2);
    expect(onStopTask).toHaveBeenCalledTimes(1);
    expect(onStopTask).toHaveBeenCalledWith("task-2");
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it(`shows a launched task's stop control disabled with the reason until the agent names the task, then enables the same control in place (${ISSUE_749})`, async () => {
    const onStopTask = jest.fn();
    const launching = makeTask({ taskId: undefined });
    const { rerenderWith } = renderIndicator({
      defaultOpen: true,
      onStopTask,
      tasks: [launching],
    });
    const stop = screen.getByRole("button", { name: "Stop task" });
    const row = screen.getByText("Count words in Welcome", { exact: false });

    fireEvent.click(stop);
    fireEvent.focus(stop);

    expect(stop.getAttribute("aria-disabled")).toBe("true");
    expect(onStopTask).not.toHaveBeenCalled();
    expect((await screen.findAllByText(STOP_UNAVAILABLE_UNTIL_STARTED)).length).toBeGreaterThan(0);

    rerenderWith({ defaultOpen: true, onStopTask, tasks: [{ ...launching, taskId: "task-1" }] });
    fireEvent.click(stop);

    expect(screen.getByRole("button", { name: "Stop task" })).toBe(stop);
    expect(screen.getByText("Count words in Welcome", { exact: false })).toBe(row);
    expect(stop.getAttribute("aria-disabled")).toBeNull();
    expect(onStopTask).toHaveBeenCalledWith("task-1");
  });

  it(`shows no stop control when the agent cannot stop one task (${ISSUE_748})`, () => {
    renderIndicator({ defaultOpen: true });

    expect(screen.getByText("Print 30 progress lines")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop task" })).toBeNull();
  });
});

import { TaskCard } from "@/agentMode/ui/TaskCard";
import { makeCommandTask, makeTask } from "@/agentMode/ui/testing/taskFixtures";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const ISSUE_749 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/749";

describe("TaskCard", () => {
  it(`shows a subagent's type, title and that it is running (${ISSUE_749})`, () => {
    render(<TaskCard task={makeTask()} onOpen={jest.fn()} />);

    expect(screen.getByText("general-purpose · Count words in Welcome")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
  });

  it.each([
    ["completed", "Completed"],
    ["failed", "Failed"],
    ["stopped", "Stopped"],
  ] as const)(
    `shows a %s task's final status and no result text (${ISSUE_749})`,
    (status, label) => {
      render(
        <TaskCard
          task={makeCommandTask({ status, summary: "Background command done" })}
          onOpen={jest.fn()}
        />
      );

      expect(screen.getByText("Print 30 progress lines")).toBeTruthy();
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.queryByText("Background command done")).toBeNull();
    }
  );

  it(`opens the task's view when clicked, whether running or finished (${ISSUE_749})`, () => {
    const onOpen = jest.fn();
    render(<TaskCard task={makeTask({ status: "completed" })} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button"));

    expect(onOpen).toHaveBeenCalledWith("task-1");
  });
});

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AgentProjectHeader } from "@/agentMode/ui/AgentProjectHeader";

beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
});

function renderHeader(props: Partial<React.ComponentProps<typeof AgentProjectHeader>> = {}) {
  const onExit = props.onExit ?? jest.fn();
  const menu = "menu" in props ? props.menu : <button type="button" aria-label="Project options" />;
  render(
    <TooltipProvider>
      <AgentProjectHeader
        projectName={"projectName" in props ? props.projectName : "Demo"}
        title={props.title}
        onExit={onExit}
        menu={menu}
        orphaned={props.orphaned}
        canLeaveProject={props.canLeaveProject}
      />
    </TooltipProvider>
  );
  return { onExit };
}

describe("AgentProjectHeader", () => {
  describe("AgentProjectHeader()", () => {
    it("shows the live project name", () => {
      renderHeader({ projectName: "My Research" });
      expect(screen.getByText("My Research")).toBeTruthy();
    });

    it("exits the project when the back affordance is clicked", () => {
      const { onExit } = renderHeader();
      fireEvent.click(screen.getByRole("button", { name: "Leave project" }));
      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it("hides the leave button when leaving the project is not allowed, keeping the project name and menu, for https://github.com/Brevilabs/obsidian-copilot-private/issues/804", () => {
      renderHeader({ projectName: "Research", title: "Compare vendors", canLeaveProject: false });

      expect(screen.queryByRole("button", { name: "Leave project" })).toBeNull();
      expect(screen.getByText("Research")).toBeTruthy();
      expect(screen.getByText("Compare vendors")).toBeTruthy();
      expect(screen.getByLabelText("Project options")).toBeTruthy();
    });

    it("renders the provided options menu in the trailing slot", () => {
      renderHeader({ menu: <button type="button" aria-label="Project options" /> });
      expect(screen.getByLabelText("Project options")).toBeTruthy();
    });

    it("degrades to an escape hatch when the project is orphaned", () => {
      const { onExit } = renderHeader({ projectName: "Gone", orphaned: true });
      expect(screen.queryByText("Gone")).toBeNull();
      expect(screen.queryByLabelText("Project options")).toBeNull();
      expect(screen.getByText("This project no longer exists")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Leave project" }));
      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it("shows the chat title after the project name as Project / Title for https://github.com/Brevilabs/obsidian-copilot-private/issues/804", () => {
      renderHeader({ projectName: "Research", title: "Compare vendors" });

      expect(screen.getByText("Research")).toBeTruthy();
      expect(screen.getByText("/")).toBeTruthy();
      expect(screen.getByText("Compare vendors")).toBeTruthy();
    });

    it("shows no separator when there is no chat title", () => {
      renderHeader({ projectName: "Research" });

      expect(screen.queryByText("/")).toBeNull();
    });

    it("shows the title alone, with no leave button, project name or options menu, for a chat outside any project for https://github.com/Brevilabs/obsidian-copilot-private/issues/804", () => {
      renderHeader({
        projectName: undefined,
        title: "Weekly review",
        canLeaveProject: false,
        menu: undefined,
      });

      expect(screen.getByText("Weekly review")).toBeTruthy();
      expect(screen.queryByText("/")).toBeNull();
      expect(screen.queryByRole("button", { name: "Leave project" })).toBeNull();
    });

    it("omits the chat title when the project no longer exists", () => {
      renderHeader({ projectName: "Gone", title: "Old chat", orphaned: true });

      expect(screen.queryByText("Old chat")).toBeNull();
      expect(screen.getByText("This project no longer exists")).toBeTruthy();
    });
  });
});

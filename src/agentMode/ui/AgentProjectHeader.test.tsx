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
        projectName={props.projectName ?? "Demo"}
        onExit={onExit}
        menu={menu}
        orphaned={props.orphaned}
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
  });
});

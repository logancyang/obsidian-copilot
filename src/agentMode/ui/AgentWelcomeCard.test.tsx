import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgentWelcomeCard } from "@/agentMode/ui/AgentWelcomeCard";

describe("AgentWelcomeCard", () => {
  it("renders the project nudge copy and a create CTA", () => {
    render(<AgentWelcomeCard onCreate={jest.fn()} onDismiss={jest.fn()} />);
    expect(screen.getByText("Try a project")).toBeTruthy();
    expect(screen.getByText("New project")).toBeTruthy();
  });

  it("invokes onCreate when the CTA is clicked", () => {
    const onCreate = jest.fn();
    render(<AgentWelcomeCard onCreate={onCreate} onDismiss={jest.fn()} />);
    fireEvent.click(screen.getByText("New project"));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("invokes onDismiss from the × control", () => {
    const onDismiss = jest.fn();
    render(<AgentWelcomeCard onCreate={jest.fn()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

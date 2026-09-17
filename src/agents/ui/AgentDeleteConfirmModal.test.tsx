import { AgentDeleteConfirmBody } from "@/agents/ui/AgentDeleteConfirmModal";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

function renderBody(overrides: { onCancel?: () => void; onConfirm?: () => void } = {}) {
  const onCancel = overrides.onCancel ?? jest.fn();
  const onConfirm = overrides.onConfirm ?? jest.fn();
  render(
    <AgentDeleteConfirmBody
      name="Jennifer"
      folderPath="copilot/agents/jennifer"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
  return { onCancel, onConfirm };
}

describe("AgentDeleteConfirmBody", () => {
  // designdocs/CUSTOM_AGENTS.md §1: deleting an agent trashes the folder with a
  // confirm dialog that says the memory file goes too — it is the part the user
  // cannot recreate.
  it("warns that the agent's memory goes with it", () => {
    renderBody();
    expect(screen.getByText(/Everything Jennifer remembers goes with it/)).toBeTruthy();
  });

  it("names both files that will be trashed", () => {
    renderBody();
    expect(screen.getByText(/copilot\/agents\/jennifer\/agent\.md/)).toBeTruthy();
    expect(screen.getByText(/copilot\/agents\/jennifer\/MEMORY\.md/)).toBeTruthy();
  });

  it("explains that chats which used the agent keep their label and answer as Copilot", () => {
    renderBody();
    expect(screen.getByText(/keep their label but answer as Copilot/)).toBeTruthy();
  });

  it("deletes only when the destructive button is pressed", () => {
    const { onCancel, onConfirm } = renderBody();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete agent" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  AgentProjectCreateForm,
  makeNewProjectConfig,
} from "@/agentMode/ui/AgentProjectCreateForm";

beforeAll(() => {
  // jsdom's `crypto` has no `randomUUID`; `makeNewProjectConfig` needs it. Use a
  // counter so each call is unique (the real runtime is Electron/Obsidian).
  const cryptoObj = window.crypto as { randomUUID?: () => string };
  if (typeof cryptoObj.randomUUID !== "function") {
    let counter = 0;
    cryptoObj.randomUUID = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
  }
});

function renderForm(props: Partial<React.ComponentProps<typeof AgentProjectCreateForm>> = {}) {
  const onSave = props.onSave ?? jest.fn().mockResolvedValue(undefined);
  const onCancel = props.onCancel ?? jest.fn();
  render(<AgentProjectCreateForm {...props} onSave={onSave} onCancel={onCancel} />);
  return { onSave, onCancel };
}

describe("AgentProjectCreateForm", () => {
  it("disables Create until a name is entered", () => {
    renderForm();
    const create = screen.getByText("Create").closest("button") as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("Project name"), {
      target: { value: "  Research  " },
    });
    expect(create.disabled).toBe(false);
  });

  it("saves the trimmed name", async () => {
    const { onSave } = renderForm();
    fireEvent.change(screen.getByPlaceholderText("Project name"), {
      target: { value: "  Research  " },
    });
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ name: "Research" }));
  });

  it("submits on Enter from the name field", async () => {
    const { onSave } = renderForm();
    const input = screen.getByPlaceholderText("Project name");
    fireEvent.change(input, { target: { value: "Research" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ name: "Research" }));
  });

  it("cancels without saving", () => {
    const { onCancel, onSave } = renderForm();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("makeNewProjectConfig", () => {
  it("builds a name-only config with the Agent-Mode-empty defaults", () => {
    const project = makeNewProjectConfig("Research");
    expect(project.name).toBe("Research");
    // Agent Mode never reads the CAG model selector → left empty, not defaulted.
    expect(project.systemPrompt).toBe("");
    expect(project.projectModelKey).toBe("");
    expect(project.modelConfigs).toEqual({});
    expect(project.contextSource).toEqual({
      inclusions: "",
      exclusions: "",
      webUrls: "",
      youtubeUrls: "",
    });
    expect(project.created).toBe(project.UsageTimestamps);
    expect(typeof project.created).toBe("number");
  });

  it("assigns a unique id per call", () => {
    expect(makeNewProjectConfig("A").id).not.toBe(makeNewProjectConfig("A").id);
  });
});

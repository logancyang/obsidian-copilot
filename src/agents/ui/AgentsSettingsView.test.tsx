import type { AgentEditorProps } from "@/agents/ui/AgentEditor";
import type { AgentRowItem } from "@/agents/ui/AgentRow";
import {
  AgentsSettingsView,
  type AgentRowActions,
  type AgentsSettingsViewProps,
} from "@/agents/ui/AgentsSettingsView";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/components/ui/SelfHostCloudWarningIcon", () => ({
  SelfHostCloudWarningIcon: () => <span data-testid="cloud-warning" />,
}));

beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
  if (!("PointerEvent" in window)) {
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
  }
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const JENNIFER: AgentRowItem = {
  slug: "jennifer",
  name: "Jennifer",
  description: "Skeptical editor. Cuts fluff, argues for the reader.",
  avatarSrc: null,
  backendLabel: "Claude Code",
  cloudEgress: false,
  memoryLabel: "2.6 KB",
};

const VANCAT: AgentRowItem = {
  slug: "vancat",
  name: "Vancat",
  description: "Blunt systems reviewer.",
  avatarSrc: null,
  backendLabel: null,
  cloudEgress: false,
  memoryLabel: null,
};

function noopActions(): AgentRowActions {
  return {
    onOpen: jest.fn(),
    onOpenFolder: jest.fn(),
    onDelete: jest.fn(),
  };
}

function editorProps(overrides: Partial<AgentEditorProps> = {}): AgentEditorProps {
  return {
    mode: "create",
    slug: null,
    draft: {
      name: "",
      description: "",
      instructions: "",
      backendId: "",
      modelId: "",
      effort: "",
      memoryEnabled: true,
      avatarSrc: null,
    },
    onChange: jest.fn(),
    onPickAvatar: jest.fn(),
    onRemoveAvatar: jest.fn(),
    backendOptions: [{ label: "Session default", value: "" }],
    modelOptions: [{ label: "Backend default", value: "" }],
    effortOptions: [{ label: "Model default", value: "" }],
    error: null,
    saving: false,
    onSave: jest.fn(),
    onCancel: jest.fn(),
    ...overrides,
  };
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>("button", { name });
}

function select(name: string): HTMLSelectElement {
  return screen.getByLabelText<HTMLSelectElement>(name);
}

function renderView(overrides: Partial<AgentsSettingsViewProps> = {}) {
  const props: AgentsSettingsViewProps = {
    agentsFolder: "copilot/agents",
    agents: [],
    searchValue: "",
    onSearchChange: jest.fn(),
    onNewAgent: jest.fn(),
    actions: noopActions(),
    editor: null,
    ...overrides,
  };
  return { props, ...render(<AgentsSettingsView {...props} />) };
}

describe("AgentsSettingsView", () => {
  it("offers the creation-first empty state naming the agents folder when there are none", () => {
    renderView();

    expect(screen.getByText("No agents yet")).toBeTruthy();
    expect(screen.getByText(/copilot\/agents\//)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Agent editor" })).toBeNull();
  });

  it("lists each agent with its description, pinned backend, and memory size", () => {
    renderView({ agents: [JENNIFER, VANCAT] });

    expect(screen.getByText("Jennifer")).toBeTruthy();
    expect(screen.getByText("Skeptical editor. Cuts fluff, argues for the reader.")).toBeTruthy();
    expect(screen.getByText("Claude Code")).toBeTruthy();
    expect(screen.getByText("2.6 KB")).toBeTruthy();
  });

  it("marks an agent pinned to a cloud backend so Self-Host Mode is not silently bypassed", () => {
    renderView({ agents: [{ ...JENNIFER, cloudEgress: true }] });
    expect(screen.getByTestId("cloud-warning")).toBeTruthy();
  });

  it("leaves an agent on a self-hostable backend unmarked", () => {
    renderView({ agents: [JENNIFER] });
    expect(screen.queryByTestId("cloud-warning")).toBeNull();
  });

  it("reports memory as off for an agent that keeps none", () => {
    renderView({ agents: [VANCAT] });
    expect(screen.getByText("Memory off")).toBeTruthy();
  });

  it("counts every agent, not just the ones matching the current search", () => {
    renderView({ agents: [JENNIFER, VANCAT], searchValue: "jen" });

    expect(screen.getByText("2 loaded")).toBeTruthy();
    expect(screen.getByText("Jennifer")).toBeTruthy();
    expect(screen.queryByText("Vancat")).toBeNull();
  });

  it("matches the search against descriptions as well as names", () => {
    renderView({ agents: [JENNIFER, VANCAT], searchValue: "systems" });
    expect(screen.getByText("Vancat")).toBeTruthy();
    expect(screen.queryByText("Jennifer")).toBeNull();
  });

  it("explains an empty result instead of leaving the list blank", () => {
    renderView({ agents: [JENNIFER], searchValue: "nobody" });
    expect(screen.getByText(/No agents match/)).toBeTruthy();
  });

  it("asks the container for a new agent when New agent is pressed", () => {
    const onNewAgent = jest.fn();
    renderView({ onNewAgent });

    fireEvent.click(screen.getByRole("button", { name: "New agent" }));

    expect(onNewAgent).toHaveBeenCalledTimes(1);
  });

  it("replaces the roster with the new agent's page while one is being created", () => {
    renderView({ agents: [JENNIFER], editor: editorProps() });

    expect(screen.getByRole("heading", { name: "New agent" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create agent" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Your agents" })).toBeNull();
  });

  it("returns to the roster through the back control without saving", () => {
    const onCancel = jest.fn();
    renderView({ editor: editorProps({ onCancel }) });

    fireEvent.click(screen.getByRole("button", { name: "Agents" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows the agent's folder, a Save button, and its scratchpad, memory and delete actions when editing", () => {
    const memory = {
      sizeLabel: "2.6 KB",
      onOpenScratchpad: jest.fn(),
      onOpenMemory: jest.fn(),
      onOpenTodaysNotes: jest.fn(),
      onConsolidate: jest.fn(),
      onClear: jest.fn(),
    };
    const onDelete = jest.fn();
    renderView({
      agents: [JENNIFER],
      editor: editorProps({
        mode: "edit",
        slug: "jennifer",
        draft: {
          name: "Jennifer",
          description: "Skeptical editor.",
          instructions: "You are Jennifer.",
          backendId: "claude",
          modelId: "",
          effort: "",
          memoryEnabled: true,
          avatarSrc: null,
        },
        onOpenInEditor: jest.fn(),
        memory,
        onDelete,
      }),
    });

    expect(screen.getByRole("heading", { name: "Jennifer" })).toBeTruthy();
    expect(screen.getByText("Stored in the agent's folder: jennifer/")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open agent.md" })).toBeTruthy();
    expect(screen.getByText(/MEMORY\.md \(2\.6 KB\)/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Scratchpad" }));
    fireEvent.click(screen.getByRole("button", { name: "Consolidate now" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete agent…" }));

    expect(memory.onOpenScratchpad).toHaveBeenCalledTimes(1);
    expect(memory.onConsolidate).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("offers no memory or delete actions for an agent that does not exist yet", () => {
    renderView({ editor: editorProps() });

    expect(screen.queryByRole("button", { name: "Consolidate now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete agent…" })).toBeNull();
  });

  it("shows only the roster until an agent is opened", () => {
    renderView({ agents: [JENNIFER] });
    expect(screen.queryByRole("region", { name: "Agent editor" })).toBeNull();
  });

  it("routes the row menu's folder action to that row's agent", () => {
    const actions = noopActions();
    renderView({ agents: [JENNIFER], actions });

    fireEvent.pointerDown(screen.getByLabelText("More actions for Jennifer"), { button: 0 });
    fireEvent.click(screen.getByText("Open folder"));

    expect(actions.onOpenFolder).toHaveBeenCalledWith("jennifer");
  });

  it("asks to delete the agent whose row menu was used", () => {
    const actions = noopActions();
    renderView({ agents: [JENNIFER, VANCAT], actions });

    fireEvent.pointerDown(screen.getByLabelText("More actions for Vancat"), { button: 0 });
    fireEvent.click(screen.getByText("Delete…"));

    expect(actions.onDelete).toHaveBeenCalledWith("vancat");
  });

  it("opens an agent's page when anywhere on its row is clicked", () => {
    const actions = noopActions();
    renderView({ agents: [JENNIFER], actions });

    fireEvent.click(screen.getByText("Skeptical editor. Cuts fluff, argues for the reader."));

    expect(actions.onOpen).toHaveBeenCalledWith("jennifer");
  });
});

describe("AgentEditor", () => {
  it("blocks saving until the required name is filled in", () => {
    renderView({ editor: editorProps() });
    expect(button("Create agent").disabled).toBe(true);
  });

  it("enables saving once a name is present", () => {
    renderView({
      editor: editorProps({
        draft: { ...editorProps().draft, name: "Jennifer" },
      }),
    });
    expect(button("Create agent").disabled).toBe(false);
  });

  it("leaves the model picker disabled until a backend is pinned", () => {
    renderView({ editor: editorProps() });
    expect(select("Model").disabled).toBe(true);
  });

  it("enables the model picker once the agent pins a backend", () => {
    renderView({
      editor: editorProps({ draft: { ...editorProps().draft, backendId: "claude" } }),
    });
    expect(select("Model").disabled).toBe(false);
  });

  it("clears the pinned model when the backend changes, since models belong to a backend", () => {
    const onChange = jest.fn();
    renderView({
      editor: editorProps({
        onChange,
        backendOptions: [
          { label: "Session default", value: "" },
          { label: "Claude Code", value: "claude" },
        ],
        draft: { ...editorProps().draft, backendId: "", modelId: "sonnet" },
      }),
    });

    fireEvent.change(select("Backend"), { target: { value: "claude" } });

    expect(onChange).toHaveBeenCalledWith({ backendId: "claude", modelId: "", effort: "" });
  });

  const EFFORT_OPTIONS = [
    { label: "Model default", value: "" },
    { label: "Low", value: "low" },
    { label: "High", value: "high" },
  ];

  it("leaves the effort picker disabled until a model is pinned (designdocs/CUSTOM_AGENTS.md §7)", () => {
    renderView({
      editor: editorProps({
        effortOptions: EFFORT_OPTIONS,
        draft: { ...editorProps().draft, backendId: "claude", modelId: "" },
      }),
    });
    expect(select("Effort").disabled).toBe(true);
  });

  it("offers the pinned model's effort levels once a model is pinned", () => {
    renderView({
      editor: editorProps({
        effortOptions: EFFORT_OPTIONS,
        draft: { ...editorProps().draft, backendId: "claude", modelId: "sonnet" },
      }),
    });
    expect(select("Effort").disabled).toBe(false);
    expect([...select("Effort").options].map((option) => option.value)).toEqual([
      "",
      "low",
      "high",
    ]);
  });

  it("disables the effort picker for a model that advertises no levels", () => {
    renderView({
      editor: editorProps({
        draft: { ...editorProps().draft, backendId: "claude", modelId: "haiku" },
      }),
    });
    expect(select("Effort").disabled).toBe(true);
  });

  it("clears the pinned effort when the model changes, since levels belong to a model", () => {
    const onChange = jest.fn();
    renderView({
      editor: editorProps({
        onChange,
        modelOptions: [
          { label: "Backend default", value: "" },
          { label: "Opus", value: "opus" },
        ],
        effortOptions: EFFORT_OPTIONS,
        draft: { ...editorProps().draft, backendId: "claude", modelId: "", effort: "high" },
      }),
    });

    fireEvent.change(select("Model"), { target: { value: "opus" } });

    expect(onChange).toHaveBeenCalledWith({ modelId: "opus", effort: "" });
  });

  it("hands a picked image file to the container to encode and preview", () => {
    const onPickAvatar = jest.fn();
    renderView({ editor: editorProps({ onPickAvatar }) });
    const file = new File(["x"], "me.png", { type: "image/png" });

    fireEvent.change(screen.getByLabelText("Profile image"), { target: { files: [file] } });

    expect(onPickAvatar).toHaveBeenCalledWith(file);
  });

  it("offers to remove an image only while the agent has one", () => {
    const onRemoveAvatar = jest.fn();
    const { rerender, props } = renderView({ editor: editorProps({ onRemoveAvatar }) });
    expect(screen.getByRole("button", { name: "Upload image" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();

    const withImage = editorProps({
      onRemoveAvatar,
      draft: { ...editorProps().draft, avatarSrc: "blob:avatar" },
    });
    rerender(<AgentsSettingsView {...props} editor={withImage} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.getByRole("button", { name: "Change image" })).toBeTruthy();
    expect(onRemoveAvatar).toHaveBeenCalledTimes(1);
  });

  it("reports a rejected save above the buttons rather than silently doing nothing", () => {
    renderView({
      editor: editorProps({ error: "Could not read that image." }),
    });
    expect(screen.getByRole("alert").textContent).toBe("Could not read that image.");
  });

  it("shows progress and blocks a second submit while a save is in flight", () => {
    renderView({
      editor: editorProps({ saving: true, draft: { ...editorProps().draft, name: "Jennifer" } }),
    });
    expect(button("Saving…").disabled).toBe(true);
  });
});

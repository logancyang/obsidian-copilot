import type { AgentEditorProps } from "@/agents/ui/AgentEditor";
import type { AgentRowItem } from "@/agents/ui/AgentRow";
import {
  AgentsSettingsView,
  type AgentRowActions,
  type AgentsSettingsViewProps,
} from "@/agents/ui/AgentsSettingsView";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

// The cloud-egress marker is a hover tooltip, so its copy is not in the tree
// until the pointer arrives. Stand it in by test id, as the model pickers do.
jest.mock("@/components/ui/SelfHostCloudWarningIcon", () => ({
  SelfHostCloudWarningIcon: () => <span data-testid="cloud-warning" />,
}));

// Radix's dropdown portals resolve `activeDocument` at render time and its
// trigger relies on Pointer Capture, neither of which jsdom implements.
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
  icon: "🪶",
  backendLabel: "Claude Code",
  cloudEgress: false,
  memoryLabel: "2.6 KB",
};

const VANCAT: AgentRowItem = {
  slug: "vancat",
  name: "Vancat",
  description: "Blunt systems reviewer.",
  icon: "🐈",
  backendLabel: null,
  cloudEgress: false,
  memoryLabel: null,
};

function noopActions(): AgentRowActions {
  return {
    onSelect: jest.fn(),
    onEdit: jest.fn(),
    onOpenFolder: jest.fn(),
    onOpenMemory: jest.fn(),
    onClearMemory: jest.fn(),
    onDelete: jest.fn(),
  };
}

function editorProps(overrides: Partial<AgentEditorProps> = {}): AgentEditorProps {
  return {
    mode: "create",
    slug: null,
    draft: {
      name: "",
      icon: "",
      description: "",
      instructions: "",
      backendId: "",
      modelId: "",
      effort: "",
      memoryEnabled: true,
    },
    onChange: jest.fn(),
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
    selectedSlug: null,
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

  it("opens the create editor beside the list even while no agent exists", () => {
    renderView({ editor: editorProps() });

    expect(screen.getByRole("heading", { name: "New agent" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create agent" })).toBeTruthy();
    expect(screen.queryByText("No agents yet")).toBeNull();
  });

  it("shows the settled folder name and a Save button when editing an existing agent", () => {
    renderView({
      agents: [JENNIFER],
      selectedSlug: "jennifer",
      editor: editorProps({
        mode: "edit",
        slug: "jennifer",
        draft: {
          name: "Jennifer",
          icon: "🪶",
          description: "Skeptical editor.",
          instructions: "You are Jennifer.",
          backendId: "claude",
          modelId: "",
          effort: "",
          memoryEnabled: true,
        },
        onOpenInEditor: jest.fn(),
      }),
    });

    expect(screen.getByRole("heading", { name: "Edit agent" })).toBeTruthy();
    expect(screen.getByText("Folder: jennifer")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open in editor" })).toBeTruthy();
  });

  it("shows only the roster until an agent is opened", () => {
    renderView({ agents: [JENNIFER] });
    expect(screen.queryByRole("region", { name: "Agent editor" })).toBeNull();
  });

  it("routes every row-menu action to the selected agent", () => {
    const actions = noopActions();
    renderView({ agents: [JENNIFER], actions });

    fireEvent.pointerDown(screen.getByLabelText("More actions for Jennifer"), { button: 0 });
    fireEvent.click(screen.getByText("Open memory"));

    expect(actions.onOpenMemory).toHaveBeenCalledWith("jennifer");
  });

  it("asks to delete the agent whose row menu was used", () => {
    const actions = noopActions();
    renderView({ agents: [JENNIFER, VANCAT], actions });

    fireEvent.pointerDown(screen.getByLabelText("More actions for Vancat"), { button: 0 });
    fireEvent.click(screen.getByText("Delete…"));

    expect(actions.onDelete).toHaveBeenCalledWith("vancat");
  });

  it("selects an agent when its row body is clicked", () => {
    const actions = noopActions();
    renderView({ agents: [JENNIFER], actions });

    fireEvent.click(screen.getByText("Jennifer"));

    expect(actions.onSelect).toHaveBeenCalledWith("jennifer");
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

  it("reports a rejected save above the buttons rather than silently doing nothing", () => {
    renderView({
      editor: editorProps({ error: "The icon must be a single emoji or letter." }),
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "The icon must be a single emoji or letter."
    );
  });

  it("shows progress and blocks a second submit while a save is in flight", () => {
    renderView({
      editor: editorProps({ saving: true, draft: { ...editorProps().draft, name: "Jennifer" } }),
    });
    expect(button("Saving…").disabled).toBe(true);
  });
});

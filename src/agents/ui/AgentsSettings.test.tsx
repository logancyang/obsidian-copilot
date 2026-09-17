import type { AgentDraft, AgentRecord } from "@/agents/types";
import { AgentsSettings } from "@/agents/ui/AgentsSettings";
import { AppContext } from "@/context";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";

const listAgents = jest.fn<Promise<AgentRecord[]>, []>();
const createAgent = jest.fn<Promise<AgentRecord>, [AgentDraft]>();
const updateAgent = jest.fn<Promise<AgentRecord>, [string, AgentDraft]>();
const deleteAgent = jest.fn<Promise<void>, [string]>();
const clearMemory = jest.fn<Promise<void>, [string]>();

jest.mock("@/agents/AgentFileManager", () => ({
  AgentFileManager: class {
    listAgents = listAgents;
    createAgent = createAgent;
    updateAgent = updateAgent;
    deleteAgent = deleteAgent;
    clearMemory = clearMemory;
  },
}));

jest.mock("@/agentMode", () => ({
  listBackendDescriptors: () => [
    {
      id: "claude",
      displayName: "Claude Code",
      selfHostable: false,
      getEnabledModelEntries: () => [{ baseModelId: "sonnet", name: "Sonnet" }],
    },
    {
      id: "opencode",
      displayName: "OpenCode",
      selfHostable: true,
      getEnabledModelEntries: () => [],
    },
  ],
}));

// The cloud-egress marker is a hover tooltip, so its copy is not in the tree
// until the pointer arrives. Stand it in by test id, as the model pickers do.
jest.mock("@/components/ui/SelfHostCloudWarningIcon", () => ({
  SelfHostCloudWarningIcon: () => <span data-testid="cloud-warning" />,
}));

let selfHostMode = false;
jest.mock("@/settings/model", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useSettingsValue: () => ({ copilotFolder: "copilot", enableSelfHostMode: selfHostMode }),
}));
jest.mock("@/logger", () => ({ logError: jest.fn(), logInfo: jest.fn(), logWarn: jest.fn() }));

const openVaultPath = jest.fn();
jest.mock("@/utils/openVaultPath", () => ({
  openVaultPath: (...args: unknown[]): void => {
    openVaultPath(...args);
  },
}));
const revealFolderInExplorer = jest.fn();
jest.mock("@/utils/revealFolderInExplorer", () => ({
  revealFolderInExplorer: (...args: unknown[]): void => {
    revealFolderInExplorer(...args);
  },
}));

// Capture what the confirm modal was told and let the test fire its callback,
// standing in for the user pressing "Delete agent".
let confirmDelete: (() => void | Promise<void>) | null = null;
let confirmArgs: { name: string; folderPath: string } | null = null;
jest.mock("@/agents/ui/AgentDeleteConfirmModal", () => ({
  AgentDeleteConfirmModal: class {
    constructor(
      _app: unknown,
      name: string,
      folderPath: string,
      onConfirm: () => void | Promise<void>
    ) {
      confirmArgs = { name, folderPath };
      confirmDelete = onConfirm;
    }
    open = jest.fn();
  },
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

function makeRecord(overrides: Partial<AgentRecord["agent"]> = {}): AgentRecord {
  const slug = overrides.slug ?? "jennifer";
  return {
    agent: {
      slug,
      name: "Jennifer",
      description: "Skeptical editor.",
      icon: "🪶",
      backendId: null,
      modelId: null,
      memoryEnabled: true,
      created: "2026-09-16T10:00:00Z",
      instructions: "You are Jennifer.",
      ...overrides,
    },
    folderPath: `copilot/agents/${slug}`,
    filePath: `copilot/agents/${slug}/agent.md`,
    memoryPath: `copilot/agents/${slug}/MEMORY.md`,
    memoryBytes: 2662,
  };
}

function nameInput(): HTMLInputElement {
  return screen.getByLabelText("Name");
}

const closeSettings = jest.fn();
const app = { setting: { close: closeSettings } } as unknown as App;

function renderPanel() {
  return render(
    <AppContext.Provider value={app}>
      <AgentsSettings />
    </AppContext.Provider>
  );
}

describe("AgentsSettings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    confirmDelete = null;
    confirmArgs = null;
    selfHostMode = false;
    listAgents.mockResolvedValue([]);
  });

  it("shows the agents the vault holds, with their memory size", async () => {
    listAgents.mockResolvedValue([makeRecord()]);

    renderPanel();

    expect(await screen.findByText("Jennifer")).toBeTruthy();
    expect(screen.getByText("2.6 KB")).toBeTruthy();
  });

  it("labels a pinned backend by its display name rather than its id", async () => {
    listAgents.mockResolvedValue([makeRecord({ backendId: "claude" })]);
    renderPanel();
    expect(await screen.findByText("Claude Code")).toBeTruthy();
  });

  it("writes a new agent from the create form and reloads the list", async () => {
    createAgent.mockResolvedValue(makeRecord());
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jennifer" } });
    fireEvent.change(screen.getByLabelText("Icon"), { target: { value: "🪶" } });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Skeptical editor." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    await waitFor(() =>
      expect(createAgent).toHaveBeenCalledWith({
        name: "Jennifer",
        icon: "🪶",
        description: "Skeptical editor.",
        instructions: "",
        backendId: null,
        modelId: null,
        memoryEnabled: true,
      })
    );
    // The reload after the write is what makes the new row appear.
    expect(listAgents).toHaveBeenCalledTimes(2);
  });

  it("marks an agent pinned to a cloud backend only while Self-Host Mode is on", async () => {
    selfHostMode = true;
    listAgents.mockResolvedValue([makeRecord({ backendId: "claude" })]);
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("cloud-warning")).toBeTruthy());
  });

  it("leaves a self-hostable pin unmarked in Self-Host Mode", async () => {
    selfHostMode = true;
    listAgents.mockResolvedValue([makeRecord({ backendId: "opencode" })]);
    renderPanel();

    await waitFor(() => expect(screen.getByText("OpenCode")).toBeTruthy());
    expect(screen.queryByTestId("cloud-warning")).toBeNull();
  });

  it("leaves a cloud pin unmarked when the vault is not in Self-Host Mode", async () => {
    listAgents.mockResolvedValue([makeRecord({ backendId: "claude" })]);
    renderPanel();

    await waitFor(() => expect(screen.getByText("Claude Code")).toBeTruthy());
    expect(screen.queryByTestId("cloud-warning")).toBeNull();
  });

  it("rejects an icon of more than one character before touching the vault", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jennifer" } });
    fireEvent.change(screen.getByLabelText("Icon"), { target: { value: "ab" } });
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(
      "The icon must be a single emoji or letter."
    );
    expect(createAgent).not.toHaveBeenCalled();
  });

  it("keeps the editor open and explains a failed write instead of losing the draft", async () => {
    createAgent.mockRejectedValue(new Error("Path conflict"));
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jennifer" } });
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Path conflict");
    expect(nameInput().value).toBe("Jennifer");
  });

  it("saves an edit against the agent's own slug, not its new name", async () => {
    listAgents.mockResolvedValue([makeRecord()]);
    updateAgent.mockResolvedValue(makeRecord({ name: "Jen" }));
    renderPanel();

    fireEvent.click(await screen.findByText("Jennifer"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jen" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateAgent).toHaveBeenCalledTimes(1));
    expect(updateAgent.mock.calls[0][0]).toBe("jennifer");
    expect(updateAgent.mock.calls[0][1].name).toBe("Jen");
  });

  it("reveals the agent's folder in the file explorer", async () => {
    listAgents.mockResolvedValue([makeRecord()]);
    renderPanel();

    fireEvent.pointerDown(await screen.findByLabelText("More actions for Jennifer"), {
      button: 0,
    });
    fireEvent.click(screen.getByText("Open folder"));

    expect(revealFolderInExplorer).toHaveBeenCalledWith(app, "copilot/agents/jennifer");
  });

  it("closes Settings before opening the memory note, or it would open behind the modal", async () => {
    listAgents.mockResolvedValue([makeRecord()]);
    renderPanel();

    fireEvent.pointerDown(await screen.findByLabelText("More actions for Jennifer"), {
      button: 0,
    });
    fireEvent.click(screen.getByText("Open memory"));

    expect(closeSettings).toHaveBeenCalledTimes(1);
    expect(openVaultPath).toHaveBeenCalledWith(app, "copilot/agents/jennifer/MEMORY.md", {
      newLeaf: true,
    });
  });

  it("clears the memory file and refreshes the reported size", async () => {
    listAgents.mockResolvedValue([makeRecord()]);
    clearMemory.mockResolvedValue(undefined);
    renderPanel();

    fireEvent.pointerDown(await screen.findByLabelText("More actions for Jennifer"), {
      button: 0,
    });
    fireEvent.click(screen.getByText("Clear memory"));

    await waitFor(() => expect(clearMemory).toHaveBeenCalledWith("jennifer"));
    expect(listAgents).toHaveBeenCalledTimes(2);
  });

  it("asks for confirmation naming the agent and its folder before deleting", async () => {
    listAgents.mockResolvedValue([makeRecord()]);
    renderPanel();

    fireEvent.pointerDown(await screen.findByLabelText("More actions for Jennifer"), {
      button: 0,
    });
    fireEvent.click(screen.getByText("Delete…"));

    expect(confirmArgs).toEqual({ name: "Jennifer", folderPath: "copilot/agents/jennifer" });
    expect(deleteAgent).not.toHaveBeenCalled();
  });

  it("deletes the agent only once the confirmation is accepted", async () => {
    listAgents.mockResolvedValue([makeRecord()]);
    deleteAgent.mockResolvedValue(undefined);
    renderPanel();

    fireEvent.pointerDown(await screen.findByLabelText("More actions for Jennifer"), {
      button: 0,
    });
    fireEvent.click(screen.getByText("Delete…"));
    await confirmDelete?.();

    expect(deleteAgent).toHaveBeenCalledWith("jennifer");
  });
});

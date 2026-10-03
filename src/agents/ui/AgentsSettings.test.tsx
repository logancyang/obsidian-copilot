import type { AgentDraft, AgentRecord } from "@/agents/types";
import { AgentsSettings } from "@/agents/ui/AgentsSettings";
import { openAgentSettings } from "@/settings/openSettings";
import { AppContext } from "@/context";
import { PluginProvider } from "@/contexts/PluginContext";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { App } from "obsidian";
import React from "react";

const listAgents = jest.fn<Promise<AgentRecord[]>, []>();
const createAgent = jest.fn<Promise<AgentRecord>, [AgentDraft]>();
const updateAgent = jest.fn<Promise<AgentRecord>, [string, AgentDraft]>();
const deleteAgent = jest.fn<Promise<void>, [string]>();
const clearMemory = jest.fn<Promise<void>, [string]>();
const setAvatar = jest.fn<Promise<void>, [string, ArrayBuffer | null]>();

jest.mock("@/agents/AgentFileManager", () => ({
  AgentFileManager: class {
    listAgents = listAgents;
    createAgent = createAgent;
    updateAgent = updateAgent;
    deleteAgent = deleteAgent;
    clearMemory = clearMemory;
    setAvatar = setAvatar;
  },
}));

const ENCODED_AVATAR = new ArrayBuffer(16);
jest.mock("@/agents/agentAvatarImage", () => ({
  encodeAgentAvatar: () => Promise.resolve(ENCODED_AVATAR),
  createAvatarPreviewUrl: () => "blob:preview",
  revokeAvatarPreviewUrl: () => {},
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
  resolveEffortOptions: (_manager: unknown, _backendId: string, baseModelId: string) =>
    baseModelId === "sonnet"
      ? [
          { label: "Low", value: "low" },
          { label: "High", value: "high" },
        ]
      : [],
}));

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
let confirmClear: (() => void | Promise<void>) | null = null;
let clearConfirmArgs: { name: string; memoryFolderPath: string } | null = null;
jest.mock("@/agents/ui/AgentClearMemoryConfirmModal", () => ({
  AgentClearMemoryConfirmModal: class {
    constructor(
      _app: unknown,
      name: string,
      memoryFolderPath: string,
      onConfirm: () => void | Promise<void>
    ) {
      clearConfirmArgs = { name, memoryFolderPath };
      confirmClear = onConfirm;
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
      effort: null,
      memoryEnabled: true,
      created: "2026-09-16T10:00:00Z",
      instructions: "You are Jennifer.",
      ...overrides,
    },
    folderPath: `copilot/agents/${slug}`,
    filePath: `copilot/agents/${slug}/agent.md`,
    memoryPath: `copilot/agents/${slug}/MEMORY.md`,
    memoryFolderPath: `copilot/agents/${slug}/memory`,
    memoryBytes: 2662,
    avatarSrc: null,
  };
}

function nameInput(): HTMLInputElement {
  return screen.getByLabelText("Name");
}

const closeSettings = jest.fn();
const app = { setting: { close: closeSettings } } as unknown as App;
const plugin = { agentSessionManager: {} } as unknown as Parameters<
  typeof PluginProvider
>[0]["plugin"];

function renderPanel() {
  return render(
    <PluginProvider plugin={plugin}>
      <AppContext.Provider value={app}>
        <AgentsSettings />
      </AppContext.Provider>
    </PluginProvider>
  );
}

describe("AgentsSettings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    confirmDelete = null;
    confirmArgs = null;
    confirmClear = null;
    clearConfirmArgs = null;
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
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Skeptical editor." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));

    await waitFor(() =>
      expect(createAgent).toHaveBeenCalledWith({
        name: "Jennifer",
        icon: "",
        description: "Skeptical editor.",
        instructions: "",
        backendId: null,
        modelId: null,
        effort: null,
        memoryEnabled: true,
      })
    );
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

  it("keeps the icon an agent's file already carries, since Settings no longer edits it", async () => {
    listAgents.mockResolvedValue([makeRecord()]);
    updateAgent.mockResolvedValue(makeRecord());
    renderPanel();

    fireEvent.click(await screen.findByText("Jennifer"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateAgent).toHaveBeenCalledTimes(1));
    expect(updateAgent.mock.calls[0][1].icon).toBe("🪶");
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

  it("offers the pinned model's own effort levels and writes the chosen one (designdocs/CUSTOM_AGENTS.md §7)", async () => {
    const pinned = makeRecord({ backendId: "claude", modelId: "sonnet" });
    listAgents.mockResolvedValue([pinned]);
    updateAgent.mockResolvedValue(pinned);
    renderPanel();

    fireEvent.click(await screen.findByText("Jennifer"));
    const effort = screen.getByLabelText<HTMLSelectElement>("Effort");
    expect([...effort.options].map((option) => option.value)).toEqual(["", "low", "high"]);
    fireEvent.change(effort, { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateAgent).toHaveBeenCalledTimes(1));
    expect(updateAgent.mock.calls[0][1].effort).toBe("high");
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

    fireEvent.click(await screen.findByText("Jennifer"));
    fireEvent.click(screen.getByRole("button", { name: "Open MEMORY.md" }));

    expect(closeSettings).toHaveBeenCalledTimes(1);
    expect(openVaultPath).toHaveBeenCalledWith(app, "copilot/agents/jennifer/MEMORY.md", {
      newLeaf: true,
    });
  });

  it("names the daily-notes folder before clearing, because clearing takes it too (CUSTOM_AGENTS.md §5)", async () => {
    listAgents.mockResolvedValue([makeRecord()]);
    renderPanel();

    fireEvent.click(await screen.findByText("Jennifer"));
    fireEvent.click(screen.getByRole("button", { name: "Clear memory…" }));

    expect(clearConfirmArgs).toEqual({
      name: "Jennifer",
      memoryFolderPath: "copilot/agents/jennifer/memory",
    });
    expect(clearMemory).not.toHaveBeenCalled();
  });

  it("clears the memory file and refreshes the reported size once confirmed", async () => {
    listAgents.mockResolvedValue([makeRecord()]);
    clearMemory.mockResolvedValue(undefined);
    renderPanel();

    fireEvent.click(await screen.findByText("Jennifer"));
    fireEvent.click(screen.getByRole("button", { name: "Clear memory…" }));
    await act(async () => {
      await confirmClear?.();
    });

    await waitFor(() => expect(clearMemory).toHaveBeenCalledWith("jennifer"));
    expect(listAgents).toHaveBeenCalledTimes(2);
  });

  it("writes a picked image into the agent's folder only when the page is saved", async () => {
    listAgents.mockResolvedValue([makeRecord()]);
    updateAgent.mockResolvedValue(makeRecord());
    setAvatar.mockResolvedValue(undefined);
    renderPanel();

    fireEvent.click(await screen.findByText("Jennifer"));
    const file = new File(["x"], "me.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Profile image"), { target: { files: [file] } });
    expect(await screen.findByRole("button", { name: "Change image" })).toBeTruthy();
    expect(setAvatar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(setAvatar).toHaveBeenCalledWith("jennifer", ENCODED_AVATAR));
  });

  it("removes the stored image on save after Remove is pressed", async () => {
    listAgents.mockResolvedValue([{ ...makeRecord(), avatarSrc: "app://jennifer/avatar.webp" }]);
    updateAgent.mockResolvedValue(makeRecord());
    setAvatar.mockResolvedValue(undefined);
    renderPanel();

    fireEvent.click(await screen.findByText("Jennifer"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(setAvatar).toHaveBeenCalledWith("jennifer", null));
  });

  it("leaves the stored image alone when a save changes nothing about it", async () => {
    listAgents.mockResolvedValue([makeRecord()]);
    updateAgent.mockResolvedValue(makeRecord());
    renderPanel();

    fireEvent.click(await screen.findByText("Jennifer"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateAgent).toHaveBeenCalledTimes(1));
    expect(setAvatar).not.toHaveBeenCalled();
  });

  it("opens straight on the agent page the chat landing asked for", async () => {
    listAgents.mockResolvedValue([makeRecord()]);
    openAgentSettings(
      { setting: { open: jest.fn(), openTabById: jest.fn() } } as unknown as App,
      { requestAnimationFrame: jest.fn() } as unknown as Window,
      { kind: "edit", slug: "jennifer" }
    );
    renderPanel();

    expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByLabelText<HTMLTextAreaElement>("Instructions").value).toBe(
      makeRecord().agent.instructions
    );
  });

  it("opens straight on a blank create form when the chat landing asked for a new agent", async () => {
    listAgents.mockResolvedValue([makeRecord()]);
    openAgentSettings(
      { setting: { open: jest.fn(), openTabById: jest.fn() } } as unknown as App,
      { requestAnimationFrame: jest.fn() } as unknown as Window,
      { kind: "create" }
    );
    renderPanel();

    expect(screen.getByRole("button", { name: "Create agent" })).toBeTruthy();
    expect(nameInput().value).toBe("");
    await waitFor(() => expect(listAgents).toHaveBeenCalled());
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

import { DEFAULT_SETTINGS } from "@/constants";
import { settingsAtom, settingsStore } from "@/settings/model";
import { BasicSettings } from "@/settings/v2/components/BasicSettings";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Notice } from "obsidian";
import React from "react";

// Stub the Plus banner to keep its dependency chain out of the test.
jest.mock("@/settings/v2/components/PlusSettings", () => ({ PlusSettings: () => null }));

// The Agents section is lazily imported behind a desktop gate; stub the module
// the lazy import resolves to so the test never pulls in the agentMode barrel.
jest.mock("@/settings/v2/components/AgentSettings", () => ({
  AgentSettings: () => <div data-testid="agents-section">agents</div>,
}));

const isDesktopRuntime = jest.fn<boolean, []>().mockReturnValue(true);
jest.mock("@/utils/desktopRuntime", () => ({ isDesktopRuntime: () => isDesktopRuntime() }));

// App is threaded via useApp; the root-change orchestration is unit-tested in
// copilotRootChange.test, so mock it here to observe the UI's decisions.
jest.mock("@/context", () => {
  // One object for the whole suite: the real useApp reads a context-provided singleton, so a
  // fresh object per render would hand hooks a changing dependency Obsidian never gives them.
  const app = {
    vault: { configDir: ".vault-config", getMarkdownFiles: () => [] },
    setting: { close: jest.fn() },
  };
  return {
    // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
    useApp: () => app,
  };
});

const openAgentsFile = jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined);
const readAgentsFile = jest.fn<Promise<string>, unknown[]>().mockResolvedValue("");
const writeAgentsFile = jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined);
jest.mock("@/instructions/agentsFile", () => ({
  openAgentsFile: (...a: unknown[]): Promise<void> => openAgentsFile(...a),
  readAgentsFile: (...a: unknown[]): Promise<string> => readAgentsFile(...a),
  writeAgentsFile: (...a: unknown[]): Promise<void> => writeAgentsFile(...a),
}));

const systemPrompts = jest.fn<{ title: string }[], []>().mockReturnValue([]);
jest.mock("@/system-prompts/state", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useSystemPrompts: () => systemPrompts(),
}));

// The Miyo mutation session is owned by the plugin (one per lifecycle) rather
// than captured by this tab, which mounts lazily. Hoisted so the stand-in keeps
// production's referential stability: the session is an effect dependency, and a
// fresh object per render would loop the verify effect forever.
const mockPluginInstance = { miyoMutationSession: Object.freeze({ lifecycle: 0 }) };
jest.mock("@/contexts/PluginContext", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  usePlugin: () => mockPluginInstance,
}));

const applyCopilotRootChange = jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined);
const copilotRootContainsNotes = jest.fn<boolean, unknown[]>().mockReturnValue(false);
const findCopilotRootFileConflict = jest.fn<string | null, unknown[]>().mockReturnValue(null);
jest.mock("@/settings/copilotRootChange", () => ({
  applyCopilotRootChange: (...a: unknown[]) => applyCopilotRootChange(...a),
  copilotRootContainsNotes: (...a: unknown[]) => copilotRootContainsNotes(...a),
  findCopilotRootFileConflict: (...a: unknown[]) => findCopilotRootFileConflict(...a),
}));

// The root-change trigger's read-only probe: the only way a registration that
// predates receipts (or whose receipt a reset wiped) can be reported at all.
const verifyMiyoScope = jest.fn<Promise<string>, unknown[]>().mockResolvedValue("unregistered");
jest.mock("@/miyo/miyoResync", () => ({
  verifyMiyoScope: (...a: unknown[]) => verifyMiyoScope(...a),
}));
const shouldSurfaceMiyoResync = jest.fn<boolean, unknown[]>().mockReturnValue(false);
jest.mock("@/miyo/miyoUtils", () => ({
  shouldSurfaceMiyoResync: (...a: unknown[]) => shouldSurfaceMiyoResync(...a),
  isLocalMiyoUrl: () => true,
  getMiyoCustomUrl: () => "",
}));
jest.mock("@/utils/vaultPath", () => ({ getVaultBase: () => "/abs/vault" }));

// Capture ConfirmModal construction so a test can fire its confirm callback.
let capturedOnConfirm: (() => void) | null = null;
let capturedConfirmButtonText = "";
const modalCtor = jest.fn((onConfirm: () => void, confirmButtonText: string) => {
  capturedOnConfirm = onConfirm;
  capturedConfirmButtonText = confirmButtonText;
});
jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: class {
    open = jest.fn();
    constructor(
      _app: unknown,
      onConfirm: () => void,
      _content: unknown,
      _title: string,
      confirmButtonText: string
    ) {
      modalCtor(onConfirm, confirmButtonText);
    }
  },
}));

describe("BasicSettings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnConfirm = null;
    capturedConfirmButtonText = "";
    settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, copilotFolder: "copilot" });
    copilotRootContainsNotes.mockReturnValue(false);
    findCopilotRootFileConflict.mockReturnValue(null);
    shouldSurfaceMiyoResync.mockReturnValue(false);
    verifyMiyoScope.mockResolvedValue("unregistered");
    systemPrompts.mockReturnValue([]);
    isDesktopRuntime.mockReturnValue(true);
  });

  it("puts the Agents section above General so setup comes before preferences", async () => {
    render(<BasicSettings />);
    const agents = await screen.findByTestId("agents-section");
    const general = screen.getByText("General");
    // DOCUMENT_POSITION_FOLLOWING means `general` comes after `agents`.
    expect(agents.compareDocumentPosition(general) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders a desktop-only placeholder instead of the Agents section on mobile", async () => {
    isDesktopRuntime.mockReturnValue(false);
    render(<BasicSettings />);
    expect(screen.getByText("Agent settings are available on desktop.")).not.toBeNull();
    expect(screen.queryByTestId("agents-section")).toBeNull();
    // The rest of Basic still renders.
    expect(screen.getByText("General")).not.toBeNull();
  });

  it("hides the filename template behind a collapsed Advanced disclosure", () => {
    render(<BasicSettings />);
    expect(screen.getByRole("button", { name: "Advanced" })).not.toBeNull();
    expect(screen.queryByText("Conversation Filename Template")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.getByText("Conversation Filename Template")).not.toBeNull();
  });

  it("keeps the template reachable when autosave is off", () => {
    settingsStore.set(settingsAtom, {
      ...DEFAULT_SETTINGS,
      copilotFolder: "copilot",
      autosaveChat: false,
    });
    render(<BasicSettings />);

    // Autosave off is exactly when the manual "Save Chat as Note" button
    // appears, and it names its note from this template — so this is the one
    // state where the template must not be hidden.
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.getByText("Conversation Filename Template")).not.toBeNull();
  });

  it("binds the Copilot folder input to the persisted root", () => {
    render(<BasicSettings />);
    expect(screen.getByLabelText<HTMLInputElement>("Copilot folder").value).toBe("copilot");
  });

  it("no longer renders the retired conversation folder and tag inputs", () => {
    render(<BasicSettings />);
    expect(screen.queryByText("Default Conversation Folder Name")).toBeNull();
    expect(screen.queryByText("Default Conversation Tag")).toBeNull();
  });

  it("rejects an invalid root on Apply without opening the confirm modal", () => {
    render(<BasicSettings />);
    fireEvent.change(screen.getByLabelText("Copilot folder"), { target: { value: "../escape" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Copilot folder" }));
    expect(Notice).toHaveBeenCalledTimes(1);
    expect(modalCtor).not.toHaveBeenCalled();
    expect(applyCopilotRootChange).not.toHaveBeenCalled();
  });

  it("rejects a root inside the vault's active config directory", () => {
    render(<BasicSettings />);
    fireEvent.change(screen.getByLabelText("Copilot folder"), {
      target: { value: ".vault-config/plugins" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply Copilot folder" }));

    expect(Notice).toHaveBeenCalledTimes(1);
    expect(modalCtor).not.toHaveBeenCalled();
    expect(applyCopilotRootChange).not.toHaveBeenCalled();
  });

  it("rejects a root whose path is occupied by an existing file without opening the confirm modal", () => {
    findCopilotRootFileConflict.mockReturnValue("ai.txt");
    render(<BasicSettings />);
    fireEvent.change(screen.getByLabelText("Copilot folder"), { target: { value: "ai.txt" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Copilot folder" }));
    expect(Notice).toHaveBeenCalledTimes(1);
    expect(modalCtor).not.toHaveBeenCalled();
    expect(applyCopilotRootChange).not.toHaveBeenCalled();
  });

  it("opens a warning confirmation for a root that already contains Markdown", () => {
    copilotRootContainsNotes.mockReturnValue(true);
    render(<BasicSettings />);
    fireEvent.change(screen.getByLabelText("Copilot folder"), { target: { value: "existing" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Copilot folder" }));

    expect(modalCtor).toHaveBeenCalledTimes(1);
    expect(capturedConfirmButtonText).toBe("Use folder");
    expect(applyCopilotRootChange).not.toHaveBeenCalled();

    capturedOnConfirm?.();
    expect(applyCopilotRootChange).toHaveBeenCalledWith(expect.anything(), "existing");
  });

  it("still warns when the non-empty folder is a previously used Copilot root", () => {
    settingsStore.set(settingsAtom, {
      ...DEFAULT_SETTINGS,
      copilotFolder: "copilot",
      copilotRootHistory: ["copilot", "old-root"],
    });
    copilotRootContainsNotes.mockReturnValue(true);
    render(<BasicSettings />);
    fireEvent.change(screen.getByLabelText("Copilot folder"), { target: { value: "old-root" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Copilot folder" }));

    expect(copilotRootContainsNotes).toHaveBeenCalledWith(expect.anything(), "old-root");
    expect(modalCtor).toHaveBeenCalledTimes(1);
    expect(capturedConfirmButtonText).toBe("Use folder");
  });

  it("opens the confirm modal for a valid new root and applies the change on confirm", () => {
    render(<BasicSettings />);
    fireEvent.change(screen.getByLabelText("Copilot folder"), { target: { value: "ai" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Copilot folder" }));
    expect(modalCtor).toHaveBeenCalledTimes(1);
    expect(capturedConfirmButtonText).toBe("Change folder");
    expect(applyCopilotRootChange).not.toHaveBeenCalled();

    capturedOnConfirm?.();
    expect(applyCopilotRootChange).toHaveBeenCalledWith(expect.anything(), "ai");
  });

  it("points at the Miyo tab without probing when local state already signals a resync", async () => {
    // Local evidence is enough; asking the server would add nothing.
    shouldSurfaceMiyoResync.mockReturnValue(true);
    render(<BasicSettings />);
    fireEvent.change(screen.getByLabelText("Copilot folder"), { target: { value: "ai" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Copilot folder" }));

    capturedOnConfirm?.();

    await waitFor(() =>
      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Miyo search needs a resync"),
        6000
      )
    );
    expect(verifyMiyoScope).not.toHaveBeenCalled();
  });

  it("reports a registration only the server knows about when the receipt is empty", async () => {
    // A registration made before receipts existed — or one whose receipt a Reset
    // Settings wiped — leaves no local trace, and the startup notice is gated on
    // the same empty receipt. Without this probe the user is never told.
    verifyMiyoScope.mockResolvedValue("stale");
    render(<BasicSettings />);
    fireEvent.change(screen.getByLabelText("Copilot folder"), { target: { value: "ai" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Copilot folder" }));

    capturedOnConfirm?.();

    await waitFor(() =>
      expect(Notice).toHaveBeenCalledWith(
        expect.stringContaining("Miyo search needs a resync"),
        6000
      )
    );
  });

  it("probes with the plugin's session, so a tree that outlived its lifecycle is refused", async () => {
    // The session must come from the plugin (one per lifecycle), not from this
    // tab: tabs mount lazily, so a tab first opened after a reload would
    // otherwise vouch for the incoming lifecycle while holding the old app.
    verifyMiyoScope.mockResolvedValue("covered");
    render(<BasicSettings />);
    fireEvent.change(screen.getByLabelText("Copilot folder"), { target: { value: "ai" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Copilot folder" }));

    capturedOnConfirm?.();

    await waitFor(() => expect(verifyMiyoScope).toHaveBeenCalledTimes(1));
    expect(verifyMiyoScope).toHaveBeenCalledWith(
      expect.anything(),
      mockPluginInstance.miyoMutationSession
    );
  });

  it("stays silent when the probe finds no registration exposing the new root", async () => {
    render(<BasicSettings />);
    fireEvent.change(screen.getByLabelText("Copilot folder"), { target: { value: "ai" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Copilot folder" }));

    capturedOnConfirm?.();

    await waitFor(() => expect(verifyMiyoScope).toHaveBeenCalledTimes(1));
    const noticeTexts = (Notice as unknown as jest.Mock).mock.calls.map((call) => String(call[0]));
    expect(noticeTexts.some((text) => text.includes("Miyo"))).toBe(false);
  });

  it("does nothing when Apply is pressed with the current root unchanged", () => {
    render(<BasicSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Apply Copilot folder" }));
    expect(modalCtor).not.toHaveBeenCalled();
    expect(applyCopilotRootChange).not.toHaveBeenCalled();
  });

  it("opens a blank vault AGENTS.md, never seeded from a Chat prompt", async () => {
    render(<BasicSettings />);
    fireEvent.click(await screen.findByRole("button", { name: /Open AGENTS.md/ }));
    // Opening awaits the flushed save first, so the open lands a tick later.
    await waitFor(() =>
      expect(openAgentsFile).toHaveBeenCalledWith(expect.anything(), "", "", true)
    );
  });

  it("lands a pending edit before opening the file, so the open cannot race the save", async () => {
    // Both paths create the file when it is missing; letting them race loses whatever the user
    // typed inside the debounce window to an already-exists failure.
    render(<BasicSettings />);
    const editor = await screen.findByRole("textbox", { name: "Custom vault instructions" });
    fireEvent.change(editor, { target: { value: "Always cite." } });

    fireEvent.click(screen.getByRole("button", { name: /Open AGENTS.md/ }));

    await waitFor(() =>
      expect(openAgentsFile).toHaveBeenCalledWith(expect.anything(), "", "", true)
    );
    expect(writeAgentsFile).toHaveBeenCalledWith(expect.anything(), "", "Always cite.");
    expect(writeAgentsFile.mock.invocationCallOrder[0]).toBeLessThan(
      openAgentsFile.mock.invocationCallOrder[0]
    );
  });

  it("shows what the vault AGENTS.md already says, so editing starts from the real file", async () => {
    readAgentsFile.mockResolvedValue("Cite every source.");
    render(<BasicSettings />);
    const editor = await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "Custom vault instructions",
    });
    expect(editor.value).toBe("Cite every source.");
    expect(readAgentsFile).toHaveBeenCalledWith(expect.anything(), "");
  });

  it("saves an edit back to the vault AGENTS.md once typing settles", async () => {
    jest.useFakeTimers();
    try {
      render(<BasicSettings />);
      const editor = await screen.findByRole("textbox", { name: "Custom vault instructions" });
      fireEvent.change(editor, { target: { value: "Always cite." } });

      // The debounce is what keeps this from being one vault write per keystroke.
      expect(writeAgentsFile).not.toHaveBeenCalled();
      // Async act: writes go through a queue, so the call starts a microtask after the timer.
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });

      expect(writeAgentsFile).toHaveBeenCalledWith(expect.anything(), "", "Always cite.");
    } finally {
      jest.useRealTimers();
    }
  });

  it("queues instruction writes so a slow save cannot land after — and overwrite — a newer one", async () => {
    jest.useFakeTimers();
    try {
      let settleFirst!: () => void;
      writeAgentsFile.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            settleFirst = resolve;
          })
      );
      render(<BasicSettings />);
      const editor = await screen.findByRole("textbox", { name: "Custom vault instructions" });

      fireEvent.change(editor, { target: { value: "First" } });
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(writeAgentsFile).toHaveBeenCalledTimes(1);

      // Second debounce fires while the first write is still in flight.
      fireEvent.change(editor, { target: { value: "Second" } });
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(writeAgentsFile).toHaveBeenCalledTimes(1);

      settleFirst();
      await act(async () => {
        await Promise.resolve();
      });

      expect(writeAgentsFile).toHaveBeenCalledTimes(2);
      expect(writeAgentsFile).toHaveBeenLastCalledWith(expect.anything(), "", "Second");
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not lose a pending edit when the tab closes mid-sentence", async () => {
    jest.useFakeTimers();
    try {
      const { unmount } = render(<BasicSettings />);
      const editor = await screen.findByRole("textbox", { name: "Custom vault instructions" });
      fireEvent.change(editor, { target: { value: "Half a thou" } });
      unmount();
      await act(async () => {
        await Promise.resolve();
      });

      expect(writeAgentsFile).toHaveBeenCalledWith(expect.anything(), "", "Half a thou");
    } finally {
      jest.useRealTimers();
    }
  });

  it("points a user who saved Chat prompts at the folder still holding them", () => {
    systemPrompts.mockReturnValue([{ title: "Editor" }, { title: "Researcher" }]);
    render(<BasicSettings />);
    expect(screen.getByText(/2 saved system prompts are/)).toBeTruthy();
    expect(screen.getByText("copilot/system-prompts")).toBeTruthy();
  });

  it("says nothing about Chat prompts to a user who never saved one", () => {
    render(<BasicSettings />);
    expect(screen.queryByText(/saved system prompt/)).toBeNull();
  });
});

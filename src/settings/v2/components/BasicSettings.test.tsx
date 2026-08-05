import { DEFAULT_SETTINGS } from "@/constants";
import { settingsAtom, settingsStore } from "@/settings/model";
import { BasicSettings } from "@/settings/v2/components/BasicSettings";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Notice } from "obsidian";
import React from "react";

// Stub the Plus banner to keep its dependency chain out of the test.
jest.mock("@/settings/v2/components/PlusSettings", () => ({ PlusSettings: () => null }));

// App is threaded via useApp; the root-change orchestration is unit-tested in
// copilotRootChange.test, so mock it here to observe the UI's decisions.
jest.mock("@/context", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; name must match the export
  useApp: () => ({ vault: { getMarkdownFiles: () => [] }, setting: { close: jest.fn() } }),
}));

const openAgentsFile = jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined);
jest.mock("@/instructions/agentsFile", () => ({
  openAgentsFile: (...a: unknown[]): Promise<void> => openAgentsFile(...a),
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
const isKnownCopilotRoot = jest.fn<boolean, unknown[]>().mockReturnValue(false);
jest.mock("@/settings/copilotRootChange", () => ({
  applyCopilotRootChange: (...a: unknown[]) => applyCopilotRootChange(...a),
  copilotRootContainsNotes: (...a: unknown[]) => copilotRootContainsNotes(...a),
  findCopilotRootFileConflict: (...a: unknown[]) => findCopilotRootFileConflict(...a),
  isKnownCopilotRoot: (...a: unknown[]) => isKnownCopilotRoot(...a),
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
const modalCtor = jest.fn((onConfirm: () => void) => {
  capturedOnConfirm = onConfirm;
});
jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: class {
    open = jest.fn();
    constructor(_app: unknown, onConfirm: () => void) {
      modalCtor(onConfirm);
    }
  },
}));

describe("BasicSettings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnConfirm = null;
    settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, copilotFolder: "copilot" });
    copilotRootContainsNotes.mockReturnValue(false);
    findCopilotRootFileConflict.mockReturnValue(null);
    isKnownCopilotRoot.mockReturnValue(false);
    shouldSurfaceMiyoResync.mockReturnValue(false);
    verifyMiyoScope.mockResolvedValue("unregistered");
    systemPrompts.mockReturnValue([]);
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

  it("rejects a root whose path is occupied by an existing file without opening the confirm modal", () => {
    findCopilotRootFileConflict.mockReturnValue("ai.txt");
    render(<BasicSettings />);
    fireEvent.change(screen.getByLabelText("Copilot folder"), { target: { value: "ai.txt" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Copilot folder" }));
    expect(Notice).toHaveBeenCalledTimes(1);
    expect(modalCtor).not.toHaveBeenCalled();
    expect(applyCopilotRootChange).not.toHaveBeenCalled();
  });

  it("rejects a root that already contains notes without opening the confirm modal", () => {
    copilotRootContainsNotes.mockReturnValue(true);
    render(<BasicSettings />);
    fireEvent.change(screen.getByLabelText("Copilot folder"), { target: { value: "existing" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Copilot folder" }));
    expect(Notice).toHaveBeenCalledTimes(1);
    expect(modalCtor).not.toHaveBeenCalled();
    expect(applyCopilotRootChange).not.toHaveBeenCalled();
  });

  it("opens the confirm modal for a previously-used root even though it holds Copilot notes", () => {
    // Re-activating a known Copilot root: its Markdown is Copilot's own leftover
    // data and stays QA-excluded via history, so the note guard is skipped and
    // the user reaches the confirmation instead of being blocked.
    copilotRootContainsNotes.mockReturnValue(true);
    isKnownCopilotRoot.mockReturnValue(true);
    render(<BasicSettings />);
    fireEvent.change(screen.getByLabelText("Copilot folder"), { target: { value: "old-root" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Copilot folder" }));
    expect(modalCtor).toHaveBeenCalledTimes(1);
  });

  it("opens the confirm modal for a valid new root and applies the change on confirm", () => {
    render(<BasicSettings />);
    fireEvent.change(screen.getByLabelText("Copilot folder"), { target: { value: "ai" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Copilot folder" }));
    expect(modalCtor).toHaveBeenCalledTimes(1);
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

  it("opens a blank vault AGENTS.md, never seeded from a Chat prompt", () => {
    render(<BasicSettings />);
    fireEvent.click(screen.getByRole("button", { name: /Open AGENTS.md/ }));
    expect(openAgentsFile).toHaveBeenCalledWith(expect.anything(), "", "", true);
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

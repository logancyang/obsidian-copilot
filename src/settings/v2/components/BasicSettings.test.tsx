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
  useApp: () => ({ vault: { getMarkdownFiles: () => [] } }),
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

// The post-change hybrid trigger: observe whether the auto-resync fires.
const resyncMiyoFolder = jest.fn<Promise<string>, unknown[]>().mockResolvedValue("resynced");
const verifyMiyoScope = jest.fn<Promise<string>, unknown[]>().mockResolvedValue("unregistered");
jest.mock("@/miyo/miyoResync", () => ({
  resyncMiyoFolder: (...a: unknown[]) => resyncMiyoFolder(...a),
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
    resyncMiyoFolder.mockResolvedValue("resynced");
    verifyMiyoScope.mockResolvedValue("unregistered");
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

  it("auto-resyncs Miyo after a confirmed root change when its scope went stale", async () => {
    shouldSurfaceMiyoResync.mockReturnValue(true);
    render(<BasicSettings />);
    fireEvent.change(screen.getByLabelText("Copilot folder"), { target: { value: "ai" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Copilot folder" }));

    capturedOnConfirm?.();

    await waitFor(() => expect(resyncMiyoFolder).toHaveBeenCalledTimes(1));
  });

  it("leaves Miyo alone after a root change when nothing needs resyncing", async () => {
    render(<BasicSettings />);
    fireEvent.change(screen.getByLabelText("Copilot folder"), { target: { value: "ai" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply Copilot folder" }));

    capturedOnConfirm?.();

    await waitFor(() => expect(applyCopilotRootChange).toHaveBeenCalled());
    expect(resyncMiyoFolder).not.toHaveBeenCalled();
  });

  it("notices after a root change when a live probe finds a stale pre-receipt registration", async () => {
    // Empty receipt + nothing locally surfacing a resync: the only evidence of
    // a pre-receipt-era registration is the server itself, so the trigger
    // probes read-only and points at the Miyo tab instead of mutating.
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
    expect(resyncMiyoFolder).not.toHaveBeenCalled();
  });

  it("stays silent after a root change when the live probe finds no Miyo registration", async () => {
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
});

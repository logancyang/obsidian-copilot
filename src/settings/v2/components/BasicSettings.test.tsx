import { DEFAULT_SETTINGS } from "@/constants";
import { settingsAtom, settingsStore } from "@/settings/model";
import { BasicSettings } from "@/settings/v2/components/BasicSettings";
import { fireEvent, render, screen } from "@testing-library/react";
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
const isKnownCopilotRoot = jest.fn<boolean, unknown[]>().mockReturnValue(false);
jest.mock("@/settings/copilotRootChange", () => ({
  applyCopilotRootChange: (...a: unknown[]) => applyCopilotRootChange(...a),
  copilotRootContainsNotes: (...a: unknown[]) => copilotRootContainsNotes(...a),
  isKnownCopilotRoot: (...a: unknown[]) => isKnownCopilotRoot(...a),
}));

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
    isKnownCopilotRoot.mockReturnValue(false);
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

  it("does nothing when Apply is pressed with the current root unchanged", () => {
    render(<BasicSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Apply Copilot folder" }));
    expect(modalCtor).not.toHaveBeenCalled();
    expect(applyCopilotRootChange).not.toHaveBeenCalled();
  });
});

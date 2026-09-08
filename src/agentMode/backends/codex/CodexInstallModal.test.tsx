import { CodexConfigView } from "@/agentMode/backends/codex/ui/CodexConfigView";
import { CodexBinaryManager } from "@/agentMode/backends/codex/CodexBinaryManager";
import { CodexInstallModal } from "@/agentMode/backends/codex/CodexInstallModal";
import { getCodexBinaryManager } from "@/agentMode/backends/codex/descriptor";
import type { InstalledBinary } from "@/agentMode/backends/shared/ManagedBinaryManager";
import { DEFAULT_SETTINGS } from "@/constants";
import { getSettings, settingsAtom, settingsStore } from "@/settings/model";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { App, Notice } from "obsidian";
import React from "react";

jest.mock("@/agentMode/backends/codex/ui/CodexConfigView", () => {
  const actual = jest.requireActual("@/agentMode/backends/codex/ui/CodexConfigView");
  return { ...actual, CodexConfigView: jest.fn(actual.CodexConfigView) };
});
jest.mock("@/logger", () => ({ logError: jest.fn(), logInfo: jest.fn(), logWarn: jest.fn() }));
jest.mock("@/agentMode/backends/codex/descriptor", () => ({
  detectCodexAcpPath: jest.fn().mockResolvedValue(null),
  codexAcpDetectionSearchDirs: () => [],
  getCodexBinaryManager: jest.fn(),
}));
const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/368";

class PendingInstallManager extends CodexBinaryManager {
  finish!: (installed: InstalledBinary) => void;
  protected installPipeline(): Promise<InstalledBinary> {
    return new Promise((resolve) => {
      this.finish = resolve;
    });
  }
}
class TestModal extends CodexInstallModal {
  content(): React.ReactElement {
    return this.renderContent(jest.fn());
  }
}

describe("CodexInstallModal", () => {
  describe("CodexInstallModal", () => {
    describe("renderContent()", () => {
      let tempDir: string;
      let customEntry: string;
      let manager: PendingInstallManager;
      let previousSettings: ReturnType<typeof getSettings>;
      beforeEach(() => {
        jest.clearAllMocks();
        previousSettings = getSettings();
        settingsStore.set(settingsAtom, {
          ...DEFAULT_SETTINGS,
          agentMode: {
            ...DEFAULT_SETTINGS.agentMode,
            backends: {
              codex: {
                binaryPath: "/managed/codex-acp",
                binaryVersion: "1.10.0",
                binarySource: "managed",
              },
            },
          },
        });
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-dialog-test-"));
        const packageRoot = path.join(tempDir, "node_modules", "@agentclientprotocol", "codex-acp");
        customEntry = path.join(packageRoot, "dist", "index.js");
        fs.mkdirSync(path.dirname(customEntry), { recursive: true });
        fs.writeFileSync(customEntry, "#!/usr/bin/env node\n", { mode: 0o755 });
        fs.writeFileSync(
          path.join(packageRoot, "package.json"),
          JSON.stringify({
            name: "@agentclientprotocol/codex-acp",
            version: "1.9.0",
            bin: { "codex-acp": "dist/index.js" },
          })
        );
        manager = new PendingInstallManager();
        jest.mocked(getCodexBinaryManager).mockReturnValue(manager);
      });
      afterEach(() => {
        cleanup();
        settingsStore.set(settingsAtom, previousSettings);
        fs.rmSync(tempDir, { recursive: true, force: true });
      });
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 passes the managed ownership to the existing dialog of a native bundle", () => {
        const nativeEntry = path.join(
          tempDir,
          process.platform === "win32" ? "codex-acp.exe" : "codex-acp"
        );
        fs.writeFileSync(nativeEntry, "native");
        fs.writeFileSync(
          path.join(tempDir, "provenance.json"),
          JSON.stringify({
            acpVersion: "1.10.0",
            packagingRevision: 1,
            target: `${process.platform}-${process.arch}`,
          })
        );
        settingsStore.set(settingsAtom, {
          ...getSettings(),
          agentMode: {
            ...getSettings().agentMode,
            backends: {
              codex: {
                binarySource: "managed",
                binaryVersion: "1.10.0-r1",
                binaryPath: nativeEntry,
              },
            },
          },
        });
        render(new TestModal(new App()).content());
        expect(screen.getByText("Ready")).toBeTruthy();
        expect(jest.mocked(CodexConfigView).mock.calls.at(-1)?.[0].state).toEqual({
          kind: "ready",
          source: "managed",
        });
      });
      it(`selects a custom adapter with its own version and clears all selection metadata without deleting its file for ${ISSUE}`, async () => {
        render(new TestModal(new App()).content());
        fireEvent.change(screen.getByRole("textbox"), { target: { value: customEntry } });
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Apply" })));
        await waitFor(() =>
          expect(getSettings().agentMode.backends?.codex).toMatchObject({
            binaryPath: fs.realpathSync(customEntry),
            binaryVersion: "1.9.0",
            binarySource: "custom",
          })
        );
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Clear" })));
        expect(getSettings().agentMode.backends?.codex).toMatchObject({
          binaryPath: undefined,
          binaryVersion: undefined,
          binarySource: undefined,
        });
        expect(fs.existsSync(customEntry)).toBe(true);
      });
      it(`rejects applying and clearing a path while a managed install holds the write lock for ${ISSUE}`, async () => {
        render(new TestModal(new App()).content());
        const before = getSettings().agentMode.backends?.codex;
        const installing = manager.install();
        try {
          fireEvent.change(screen.getByRole("textbox"), { target: { value: customEntry } });
          await act(async () => fireEvent.click(screen.getByRole("button", { name: "Apply" })));
          expect(screen.getByText(/setup operation is already running/)).toBeTruthy();
          expect(getSettings().agentMode.backends?.codex).toEqual(before);
          fireEvent.change(screen.getByRole("textbox"), { target: { value: before?.binaryPath } });
          await act(async () => fireEvent.click(screen.getByRole("button", { name: "Clear" })));
          expect(Notice).toHaveBeenCalledWith(
            expect.stringContaining("Couldn't clear the custom path")
          );
          expect(getSettings().agentMode.backends?.codex).toEqual(before);
        } finally {
          manager.finish({ version: "1.10.0", path: "/managed/codex-acp" });
          await installing;
        }
      });
    });
  });
});

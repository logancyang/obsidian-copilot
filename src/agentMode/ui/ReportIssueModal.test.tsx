import {
  createReportDir,
  discardReport,
  openIssuePageWith,
  openReportIssueModal,
  ReportIssueModal,
  uploadReport,
} from "@/agentMode/ui/ReportIssueModal";
import type {
  PreparedReport,
  ReportSourceId,
  ReportSourceOption,
  UploadOutcome,
} from "@/agentMode/ui/ReportIssueFlow";
import { CHAT_AGENT_VIEWTYPE } from "@/constants";
import { logWarn } from "@/logger";
import { getSettings, setSettings } from "@/settings/model";
import type { ReportInput } from "@/utils/issueReport";
import { ReportUploadError, type ReportUploader } from "@/utils/reportUpload";
import { unzipSync } from "fflate";
import { type App, Notice } from "obsidian";
import nodeOs from "node:os";
import nodePath from "node:path";

const realFs = jest.requireActual<typeof import("node:fs/promises")>("node:fs/promises");
const realIssueReport =
  jest.requireActual<typeof import("@/utils/issueReport")>("@/utils/issueReport");

const rm = jest.fn<Promise<void>, [string, unknown?]>();
const writeFile = jest.fn<Promise<void>, [string, Uint8Array]>();

jest.mock("fs/promises", () => ({
  ...jest.requireActual("fs/promises"),
  rm: (path: string, opts?: unknown) => rm(path, opts),
  writeFile: (path: string, data: Uint8Array) => writeFile(path, data),
}));

let mockDesktopRuntime = true;

jest.mock("@/utils/desktopRuntime", () => ({
  ...jest.requireActual("@/utils/desktopRuntime"),
  isDesktopRuntime: () => mockDesktopRuntime,
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

const getValidatedPath = jest.fn<Promise<string | null>, []>();
const exportLogText = jest.fn<string, []>();

jest.mock("@/agentMode/session/debugSink", () => ({
  frameSink: { getValidatedPath: () => getValidatedPath() },
}));

jest.mock("@/logFileManager", () => ({
  logFileManager: { exportLogText: () => exportLogText() },
}));

const buildReportBundle = jest.fn<
  ReturnType<typeof realIssueReport.buildReportBundle>,
  Parameters<typeof realIssueReport.buildReportBundle>
>();

jest.mock("@/utils/issueReport", () => ({
  ...jest.requireActual("@/utils/issueReport"),
  buildReportBundle: (...args: Parameters<typeof realIssueReport.buildReportBundle>) =>
    buildReportBundle(...args),
}));

const captureBehindOverlay = jest.fn<Promise<Uint8Array | null>, unknown[]>();

jest.mock("@/agentMode/ui/reportScreenshot", () => ({
  captureBehindOverlay: (...args: unknown[]) => captureBehindOverlay(...args),
}));

const openExternal = jest.fn<Promise<void>, [string]>();

jest.mock("electron", () => ({ shell: { openExternal: (url: string) => openExternal(url) } }), {
  virtual: true,
});

const noticeMock = Notice as unknown as jest.Mock;
const noticeText = (call = 0) => {
  const message = noticeMock.mock.calls[call][0] as string | DocumentFragment;
  return typeof message === "string" ? message : message.textContent;
};
const noticeLink = (call = 0) =>
  (noticeMock.mock.calls[call][0] as DocumentFragment).querySelector("a")?.getAttribute("href");

const prepared: PreparedReport = {
  zipDir: "/tmp/obsidian-copilot-report-abc123",
  zipPath: "/tmp/obsidian-copilot-report-abc123/copilot-report-20260615-101500-abcd.zip",
  zipName: "copilot-report-20260615-101500-abcd.zip",
  uploadAttempt: {
    body: new ArrayBuffer(4096),
    idempotencyKey: "5d41c9b2-7e3a-4f8b-9c1d-2a6e8f4b0d37",
  },
  issueDraft: { title: "it exploded", body: "## What went wrong" },
  manualIssueUrl: "https://github.com/logancyang/obsidian-copilot/issues/new?title=manual",
  attachments: [],
};

const reportId = "9f3c1a7b2e4d5f60819a2b3c4d5e6f70";
const issueUrl = "https://github.com/logancyang/obsidian-copilot/issues/new?title=linked";

beforeEach(() => {
  noticeMock.mockClear();
  (logWarn as jest.Mock).mockClear();
  rm.mockReset();
  rm.mockImplementation((path, opts) =>
    realFs.rm(path, opts as { recursive?: boolean; force?: boolean })
  );
  writeFile.mockReset();
  writeFile.mockImplementation((path, data) => realFs.writeFile(path, data));
  openExternal.mockReset();
  openExternal.mockResolvedValue(undefined);
  buildReportBundle.mockReset();
  buildReportBundle.mockImplementation(realIssueReport.buildReportBundle);
  captureBehindOverlay.mockReset();
  captureBehindOverlay.mockResolvedValue(null);
  getValidatedPath.mockReset();
  getValidatedPath.mockResolvedValue(null);
  exportLogText.mockReset();
  exportLogText.mockReturnValue("");
});

describe("ReportIssueModal", () => {
  describe("createReportDir()", () => {
    const created: string[] = [];

    afterEach(async () => {
      for (const dir of created.splice(0)) {
        await realFs.rm(dir, { recursive: true, force: true });
      }
    });

    const create = async () => {
      const dir = await createReportDir();
      created.push(dir);
      return dir;
    };

    (process.platform === "win32" ? it.skip : it)(
      "hands back a directory no other local account can enter",
      async () => {
        const dir = await create();

        expect((await realFs.stat(dir)).mode & 0o777).toBe(0o700);
      }
    );

    it("never hands back the same directory twice", async () => {
      const [first, second] = [await create(), await create()];

      expect(second).not.toBe(first);
    });
  });

  describe("discardReport()", () => {
    it("removes the report's directory, recursively and without failing on an absent one", async () => {
      rm.mockResolvedValue(undefined);

      await discardReport(prepared);

      expect(rm).toHaveBeenCalledTimes(1);
      expect(rm).toHaveBeenCalledWith(prepared.zipDir, { recursive: true, force: true });
    });

    it("logs a directory that would not go and resolves anyway (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      rm.mockRejectedValue(new Error("EBUSY: resource busy or locked"));

      await expect(discardReport(prepared)).resolves.toBeUndefined();

      expect(logWarn).toHaveBeenCalledTimes(1);
      expect((logWarn as jest.Mock).mock.calls[0][0]).toContain(prepared.zipDir);
    });
  });

  describe("uploadReport()", () => {
    it("sends the packed attempt and builds the linked issue URL from the report id", async () => {
      const uploader: ReportUploader = jest.fn().mockResolvedValue({
        reportId,
        expiresAt: "2026-10-18T00:00:00.000Z",
      });

      const outcome = await uploadReport(uploader, prepared);

      expect(uploader).toHaveBeenCalledWith(prepared.uploadAttempt);
      if (!outcome.ok) throw new Error("expected success");
      expect(outcome.reportId).toBe(reportId);
      const body = new URLSearchParams(outcome.issueUrl.split("?")[1]).get("body") ?? "";
      expect(body.indexOf(reportId)).toBeLessThan(60);
      expect(body).not.toContain("http");
    });

    it("hands an upload error's own message back as the failure", async () => {
      const uploader: ReportUploader = jest
        .fn()
        .mockRejectedValue(new ReportUploadError("Upload failed (HTTP 413): too large"));

      await expect(uploadReport(uploader, prepared)).resolves.toEqual({
        ok: false,
        error: "Upload failed (HTTP 413): too large",
      });
    });

    it("turns any other rejection into a failure the user can read", async () => {
      const uploader: ReportUploader = jest.fn().mockRejectedValue(new TypeError("x is null"));

      const outcome = await uploadReport(uploader, prepared);

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("expected failure");
      expect(outcome.error).not.toContain("x is null");
    });
  });

  describe("openIssuePageWith()", () => {
    it("resolves true once the browser has taken the page", async () => {
      await expect(openIssuePageWith({ openExternal }, issueUrl)).resolves.toBe(true);

      expect(openExternal).toHaveBeenCalledWith(issueUrl);
    });

    it("resolves false when there is no browser bridge", async () => {
      await expect(openIssuePageWith(null, issueUrl)).resolves.toBe(false);
    });

    it("resolves false when the bridge rejects its promise", async () => {
      openExternal.mockRejectedValue(new Error("no handler"));

      await expect(openIssuePageWith({ openExternal }, issueUrl)).resolves.toBe(false);
    });

    it("resolves false when the bridge throws before returning a promise", async () => {
      openExternal.mockImplementation(() => {
        throw new Error("bridge disposed");
      });

      await expect(openIssuePageWith({ openExternal }, issueUrl)).resolves.toBe(false);
    });
  });

  describe("openReportIssueModal()", () => {
    interface OpenedModal {
      open: jest.Mock;
      params: {
        activeBackend: string;
        pluginVersion: string;
        dismissSettings: () => void;
        canCaptureTarget: () => boolean;
        resolveCaptureTarget: () => HTMLElement | null;
      };
    }

    function appWithAgentPanes(contentEls: HTMLElement[]) {
      const revealLeaf = jest.fn();
      const leaves = contentEls.map((contentEl) => ({ view: { contentEl } }));
      const getLeavesOfType = jest.fn((type: string) =>
        type === CHAT_AGENT_VIEWTYPE ? leaves : []
      );
      const app = { workspace: { getLeavesOfType, revealLeaf } } as unknown as App;
      return { app, leaves, revealLeaf };
    }

    it("opens the dialog for the given backend and version, dismissing Settings through the caller", () => {
      const { app } = appWithAgentPanes([]);
      const dismissSettings = jest.fn();

      const modal = openReportIssueModal({
        app,
        activeBackend: "opencode",
        pluginVersion: "3.4.0",
        dismissSettings,
      }) as unknown as OpenedModal;
      modal.params.dismissSettings();

      expect(modal.open).toHaveBeenCalledTimes(1);
      expect(modal.params.activeBackend).toBe("opencode");
      expect(modal.params.pluginVersion).toBe("3.4.0");
      expect(dismissSettings).toHaveBeenCalledTimes(1);
    });

    it("reveals and photographs the first Agent Mode pane", () => {
      const pane = window.document.createElement("div");
      const { app, leaves, revealLeaf } = appWithAgentPanes([pane]);

      const modal = openReportIssueModal({
        app,
        activeBackend: "claude",
        pluginVersion: "3.4.0",
        dismissSettings: jest.fn(),
      }) as unknown as OpenedModal;

      expect(modal.params.canCaptureTarget()).toBe(true);
      expect(modal.params.resolveCaptureTarget()).toBe(pane);
      expect(revealLeaf).toHaveBeenCalledWith(leaves[0]);
    });

    it("offers no screenshot target while no Agent Mode pane is open", () => {
      const { app, revealLeaf } = appWithAgentPanes([]);

      const modal = openReportIssueModal({
        app,
        activeBackend: "claude",
        pluginVersion: "3.4.0",
        dismissSettings: jest.fn(),
      }) as unknown as OpenedModal;

      expect(modal.params.canCaptureTarget()).toBe(false);
      expect(modal.params.resolveCaptureTarget()).toBeNull();
      expect(revealLeaf).not.toHaveBeenCalled();
    });
  });

  describe("ReportIssueModal", () => {
    interface ModalUnderTest {
      close: jest.Mock;
      root: { unmount: jest.Mock } | null;
      prepared: PreparedReport | null;
      onOpen(): void;
      onClose(): void;
      buildSources(): ReportSourceOption[];
      prepare(note: string, selected: ReadonlySet<ReportSourceId>): Promise<PreparedReport>;
      upload(report: PreparedReport): Promise<UploadOutcome>;
      discard(report: PreparedReport): Promise<void>;
      onUploaded(outcome: { reportId: string; issueUrl: string }): Promise<void>;
      openIssuePage(url: string): Promise<void>;
    }

    function modalWith(fields: Record<string, unknown>): ModalUnderTest {
      return Object.assign(Object.create(ReportIssueModal.prototype), {
        contentEl: Object.assign(window.document.createElement("div"), { empty: jest.fn() }),
        containerEl: window.document.createElement("div"),
        close: jest.fn(),
        root: { unmount: jest.fn() },
        prepared: null,
        uploading: false,
        ...fields,
      }) as ModalUnderTest;
    }

    describe("onOpen()", () => {
      afterEach(() => {
        mockDesktopRuntime = true;
      });

      it("refuses to open where there is no Node runtime, instead of failing at the first disk write", () => {
        mockDesktopRuntime = false;
        const modal = modalWith({});

        modal.onOpen();

        expect(modal.close).toHaveBeenCalledTimes(1);
        expect(noticeText()).toContain("desktop only");
      });
    });

    describe("buildSources()", () => {
      const ids = (params: Record<string, unknown>) =>
        modalWith({
          params: { canCaptureTarget: () => true, activeBackend: "claude", ...params },
        })
          .buildSources()
          .map((source) => source.id);

      it("offers the screenshot only while there is a pane to photograph", () => {
        expect(ids({})).toContain("screenshot");
        expect(ids({ canCaptureTarget: () => false })).not.toContain("screenshot");
      });

      it("offers the opencode log only when opencode is the active backend", () => {
        expect(ids({})).not.toContain("opencodeLog");
        expect(ids({ activeBackend: "opencode" })).toContain("opencodeLog");
      });

      it("leaves the opencode log unchecked by default", () => {
        const opencodeLog = modalWith({
          params: { canCaptureTarget: () => true, activeBackend: "opencode" },
        })
          .buildSources()
          .find((source) => source.id === "opencodeLog");

        expect(opencodeLog?.defaultChecked).toBe(false);
      });
    });

    describe("prepare()", () => {
      const created: string[] = [];

      afterEach(async () => {
        for (const dir of created.splice(0)) {
          await realFs.rm(dir, { recursive: true, force: true });
        }
      });

      const prepare = (selected: ReadonlySet<ReportSourceId>) =>
        modalWith({
          params: {
            resolveCaptureTarget: () => null,
            dismissSettings: () => {},
            pluginVersion: "9.9.9",
            activeBackend: "claude",
          },
        })
          .prepare("it broke\n\nwhile typing", selected)
          .then((report) => {
            created.push(report.zipDir);
            return report;
          });

      const bundleInput = (): ReportInput => buildReportBundle.mock.calls[0][0];

      it("writes the zip, and nothing else, into a fresh private directory", async () => {
        const report = await prepare(new Set());

        expect(nodePath.basename(report.zipDir)).toMatch(/^obsidian-copilot-report-/);
        expect(await realFs.readdir(report.zipDir)).toEqual([report.zipName]);
        expect(report.zipPath).toBe(nodePath.join(report.zipDir, report.zipName));
        expect((await realFs.stat(report.zipPath)).size).toBe(report.uploadAttempt.body.byteLength);
      });

      it("hands back the manual issue URL and the manifest alongside the packed attempt", async () => {
        const report = await prepare(new Set());

        expect(report.manualIssueUrl).toContain("title=it+broke");
        expect(report.attachments.map((a) => a.name)).toContain("report.md");
        expect(report.uploadAttempt.idempotencyKey).not.toBe("");
      });

      it("removes the directory and rethrows when the zip cannot be written (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        writeFile.mockRejectedValue(new Error("ENOSPC: no space left on device"));

        await expect(prepare(new Set())).rejects.toThrow("ENOSPC");

        expect(rm).toHaveBeenCalledTimes(1);
        const [dir] = rm.mock.calls[0];
        expect(nodePath.basename(dir)).toMatch(/^obsidian-copilot-report-/);
        await expect(realFs.stat(dir)).rejects.toThrow();
      });

      it("goes on without the screenshot when the capture fails, and says so in the manifest (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        captureBehindOverlay.mockRejectedValue(new Error("the pane went away"));

        const report = await prepare(new Set(["screenshot"]));

        expect(logWarn).toHaveBeenCalledTimes(1);
        expect(bundleInput().screenshotPng).toBeNull();
        expect(report.attachments.find((a) => a.id === "screenshot")).toMatchObject({
          included: false,
          note: "no screenshot was captured",
        });
      });

      it("hands the assembler the captured bytes when the screenshot was selected", async () => {
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
        captureBehindOverlay.mockResolvedValue(png);

        await prepare(new Set(["screenshot"]));

        expect(bundleInput().screenshotPng).toBe(png);
      });

      it("hands the assembler null when the screenshot was selected but nothing was captured", async () => {
        captureBehindOverlay.mockResolvedValue(null);

        await prepare(new Set(["screenshot"]));

        expect(bundleInput().screenshotPng).toBeNull();
      });

      it("leaves the screenshot out of the assembler's input entirely when it was not selected (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        await prepare(new Set());

        expect(captureBehindOverlay).not.toHaveBeenCalled();
        expect(bundleInput().screenshotPng).toBeUndefined();
      });

      it("packs the activity log and the chat log it was asked for into the zip (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        const frameDir = await realFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "acp-frames-"));
        created.push(frameDir);
        const framePath = nodePath.join(frameDir, "acp-frames.ndjson");
        const frames = '{"dir":"out","method":"session/prompt"}\n';
        const chatLog = "2026-06-15 10:15:00 INFO chain ran\n";
        await realFs.writeFile(framePath, frames);
        getValidatedPath.mockResolvedValue(framePath);
        exportLogText.mockReturnValue(chatLog);

        const report = await prepare(new Set(["activityLog", "chatLog"]));

        const entries = unzipSync(new Uint8Array(await realFs.readFile(report.zipPath)));
        const entryText = (name: string) => new TextDecoder().decode(entries[name]);
        expect(entryText("acp-frames.ndjson.txt")).toBe(frames);
        expect(entryText("copilot-chat-log.md")).toBe(chatLog);
      });

      it("asks for the logs smallest-growing first, so a heavy session's frames cannot crowd the others out (https://github.com/Brevilabs/obsidian-copilot-private/issues/538)", async () => {
        await prepare(new Set(["activityLog", "chatLog", "opencodeLog"]));

        expect(bundleInput().logs.map((log) => log.id)).toEqual([
          "chatLog",
          "opencodeLog",
          "activityLog",
        ]);
      });

      it("reads no activity log, and says why, when it was selected while turned off (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        const agentMode = getSettings().agentMode;
        setSettings({ agentMode: { ...agentMode, debugFullFrames: false } });
        try {
          await prepare(new Set(["activityLog"]));
        } finally {
          setSettings({ agentMode });
        }

        expect(getValidatedPath).not.toHaveBeenCalled();
        const [request] = bundleInput().logs;
        expect(request.id).toBe("activityLog");
        expect(request.path).toBeUndefined();
        expect(request.unavailableReason).toContain("turned off");
      });
    });

    describe("upload()", () => {
      const uploaderResolving = () => jest.fn().mockResolvedValue({ reportId, expiresAt: "" });

      it("hands the outcome back while the dialog is up, with nothing announced", async () => {
        const modal = modalWith({ params: { uploader: uploaderResolving() } });

        const outcome = await modal.upload(prepared);

        expect(outcome).toMatchObject({ ok: true, reportId });
        expect(noticeMock).not.toHaveBeenCalled();
      });

      it("announces the report id with a link to the issue when the upload lands after the dialog closed (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        const modal = modalWith({ params: { uploader: uploaderResolving() }, root: null });

        await modal.upload(prepared);

        expect(openExternal).not.toHaveBeenCalled();
        expect(noticeText()).toContain(reportId);
        expect(noticeLink()).toBe(
          realIssueReport.buildLinkedReportIssueUrl(prepared.issueDraft, reportId)
        );
        expect(rm).not.toHaveBeenCalled();
      });

      it("only logs an upload that fails after the dialog closed, and keeps the zip (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        const uploader = jest.fn().mockRejectedValue(new ReportUploadError("Upload failed"));
        const modal = modalWith({ params: { uploader }, root: null });

        await modal.upload(prepared);

        expect(noticeMock).not.toHaveBeenCalled();
        expect(logWarn).toHaveBeenCalledTimes(1);
        expect(rm).not.toHaveBeenCalled();
      });
    });

    describe("onUploaded()", () => {
      it("opens the linked issue, closes the dialog and confirms the upload", async () => {
        const modal = modalWith({});

        await modal.onUploaded({ reportId, issueUrl });

        expect(openExternal).toHaveBeenCalledWith(issueUrl);
        expect(modal.close).toHaveBeenCalledTimes(1);
        expect(noticeText()).toBe("Report uploaded. Finish the issue in your browser.");
      });

      it("still closes, and hands over the id and the issue link, when the browser cannot be opened (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        openExternal.mockRejectedValue(new Error("no handler"));
        const modal = modalWith({});

        await modal.onUploaded({ reportId, issueUrl });

        expect(modal.close).toHaveBeenCalledTimes(1);
        expect(noticeText()).toContain(reportId);
        expect(noticeLink()).toBe(issueUrl);
      });

      it("leaves the zip on disk after a successful upload", async () => {
        const modal = modalWith({ prepared });

        await modal.onUploaded({ reportId, issueUrl });
        modal.onClose();

        expect(rm).not.toHaveBeenCalled();
      });
    });

    describe("openIssuePage()", () => {
      it.each(["resolved", "rejected", "pending"])(
        "preserves the manually handed-off zip through Cancel and close with a %s browser call (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)",
        async (browserState) => {
          let finish: () => void = () => {};
          if (browserState === "rejected") openExternal.mockRejectedValue(new Error("no handler"));
          if (browserState === "pending") {
            openExternal.mockImplementation(
              () =>
                new Promise<void>((resolve) => {
                  finish = resolve;
                })
            );
          }
          const modal = modalWith({ prepared });
          const opening = modal.openIssuePage(prepared.manualIssueUrl);

          await modal.discard(prepared);
          modal.onClose();
          finish();
          await opening;

          expect(rm).not.toHaveBeenCalled();
        }
      );

      it("says nothing when the browser takes the manual issue page", async () => {
        await modalWith({}).openIssuePage(prepared.manualIssueUrl);

        expect(openExternal).toHaveBeenCalledWith(prepared.manualIssueUrl);
        expect(noticeMock).not.toHaveBeenCalled();
      });

      it("hands over the link when the browser cannot be opened", async () => {
        openExternal.mockRejectedValue(new Error("no handler"));

        await modalWith({}).openIssuePage(prepared.manualIssueUrl);

        expect(noticeLink()).toBe(prepared.manualIssueUrl);
      });
    });

    describe("onClose()", () => {
      it("cleans nothing up while the user is still on the details page", () => {
        modalWith({}).onClose();

        expect(rm).not.toHaveBeenCalled();
      });

      it("discards a prepared report the user closed the dialog on instead of uploading (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        const modal = modalWith({ prepared });

        modal.onClose();
        await Promise.resolve();

        expect(rm).toHaveBeenCalledWith(prepared.zipDir, { recursive: true, force: true });
      });

      it("removes the report once, not again, after the flow's Cancel already discarded it", async () => {
        const modal = modalWith({ prepared });

        await modal.discard(prepared);
        modal.onClose();
        await Promise.resolve();

        expect(rm).toHaveBeenCalledTimes(1);
      });

      it("leaves an upload in flight alone so it can still land (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        let finish: (result: { reportId: string; expiresAt: string }) => void = () => {};
        const uploader = jest.fn(
          () => new Promise<{ reportId: string; expiresAt: string }>((res) => (finish = res))
        );
        const modal = modalWith({ params: { uploader }, prepared });

        const outcome = modal.upload(prepared);
        modal.onClose();
        finish({ reportId, expiresAt: "" });
        await outcome;

        expect(rm).not.toHaveBeenCalled();
        expect(noticeText()).toContain(reportId);
      });
    });
  });
});

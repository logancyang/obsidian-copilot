import {
  activityLogPath,
  buildReportSourceOptions,
  captureBehindOverlay,
  createReportsRootDir,
  discardReportPaths,
  openIssuePageWith,
  removeReportPaths,
  ReportIssueModal,
  uploadReport,
  waitForStableTarget,
} from "@/agentMode/ui/ReportIssueModal";
import type { PreparedReport, ReportSourceId } from "@/agentMode/ui/ReportIssueFlow";
import { ReportUploadError, type ReportUploader } from "@/utils/reportUpload";
import { Notice } from "obsidian";
import fs from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";

const rm = jest.fn<Promise<void>, [string, unknown?]>();

// Only `rm` is faked — `removeReportPaths` is asserted through it. `mkdtemp` is
// the real one so the directory it creates can be inspected on disk.
//
// Mocked under the unprefixed id, which is the one `requireNodeModule` resolves;
// Jest keys its registry on the literal specifier, so a `node:`-prefixed mock
// would sit beside the module under test rather than replacing it.
jest.mock("fs/promises", () => ({
  ...jest.requireActual("fs/promises"),
  rm: (path: string, opts?: unknown) => rm(path, opts),
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));

const frameSinkPath = jest.fn<string, []>();

jest.mock("@/agentMode/session/debugSink", () => ({
  frameSink: {
    getPath: () => frameSinkPath(),
    flush: jest.fn(async () => {}),
  },
}));

const captureViewScreenshot = jest.fn<Promise<Uint8Array>, [HTMLElement]>();

jest.mock("@/utils/captureViewScreenshot", () => ({
  captureViewScreenshot: (el: HTMLElement) => captureViewScreenshot(el),
}));

describe("ReportIssueModal", () => {
  describe("activityLogPath()", () => {
    // Built from the real temp dir rather than a fixed "/tmp/…": the guard
    // checks that the sink's answer actually lands there, and this platform's
    // temp dir is not /tmp.
    const realLogPath = nodePath.join(
      os.tmpdir(),
      "obsidian-copilot",
      "acp-frames",
      "3f9a",
      "acp-frames.ndjson"
    );

    it("returns the log's path once the sink knows where it writes", async () => {
      frameSinkPath.mockReturnValue(realLogPath);
      await expect(activityLogPath()).resolves.toBe(realLogPath);
    });

    it("rejects a path that is named right but sits outside the temp dir (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      // The name alone is not enough: anything the sink did not build belongs
      // somewhere else, and packing it would attach a file nobody asked for.
      frameSinkPath.mockReturnValue(nodePath.join(os.homedir(), "acp-frames.ndjson"));
      await expect(activityLogPath()).resolves.toBeNull();
    });

    it("rejects a path inside the temp dir that is not the log (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      // Location alone is not enough either. A process whose working directory
      // sits inside the temp dir resolves the sink's placeholder sentence to
      // somewhere underneath it, so the name has to be checked too.
      frameSinkPath.mockReturnValue(nodePath.join(os.tmpdir(), "something-else.ndjson"));
      await expect(activityLogPath()).resolves.toBeNull();
    });

    it("accepts the log when the temp dir is a filesystem root (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      // Containment written as `root + separator` becomes `//` here, and every
      // real path underneath fails it — dropping an attachment the user ticked.
      const root = nodePath.parse(os.tmpdir()).root;
      const spy = jest.spyOn(os, "tmpdir").mockReturnValue(root);
      try {
        const inRoot = nodePath.join(root, "obsidian-copilot", "acp-frames.ndjson");
        frameSinkPath.mockReturnValue(inRoot);
        await expect(activityLogPath()).resolves.toBe(inRoot);
      } finally {
        spy.mockRestore();
      }
    });

    it("rejects the sink's placeholder rather than treating it as a path (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      // The settings tab is registered during load, ahead of the dynamic import
      // that tells the sink which vault it is logging for, so a report opened in
      // that window asks a sink that has no path to give. What it answers with
      // is a sentence, and a sentence is a relative path: statting it would look
      // for it next to the process, and a hit there would be packed and uploaded
      // as though it were the activity log.
      frameSinkPath.mockReturnValue("(Agent Mode frame logs are desktop-only)");
      await expect(activityLogPath()).resolves.toBeNull();
    });

    it("rejects a log path that leads out of the temp dir through a link (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      // The sink checks its own directory chain only when it writes, so a
      // report taken before the first frame lands asks a location nobody has
      // vetted. On a temp root shared with other accounts, a link planted there
      // spells out the log's name and leads at whatever its author chose —
      // which a spelling check cannot see, and which would be uploaded.
      const dir = await fs.mkdtemp(nodePath.join(os.tmpdir(), "report-link-"));
      const secret = nodePath.join(dir, "secret.txt");
      await fs.writeFile(secret, "private");
      const link = nodePath.join(dir, "acp-frames.ndjson");
      await fs.symlink(secret, link);
      try {
        frameSinkPath.mockReturnValue(link);
        await expect(activityLogPath()).resolves.toBeNull();
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it("accepts a real log and answers with the path it checked (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      // The counterpart: resolving links away must not cost the ordinary log
      // its attachment. The answer is the resolved path so that what gets read
      // is what was checked, which on macOS differs from the temp dir's own
      // spelling because that is a link too.
      const dir = await fs.mkdtemp(nodePath.join(os.tmpdir(), "report-real-"));
      const log = nodePath.join(dir, "acp-frames.ndjson");
      await fs.writeFile(log, "{}\n");
      try {
        frameSinkPath.mockReturnValue(log);
        await expect(activityLogPath()).resolves.toBe(await fs.realpath(log));
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("createReportsRootDir()", () => {
    const realFs = jest.requireActual<typeof import("node:fs/promises")>("node:fs/promises");
    const created: string[] = [];

    afterEach(async () => {
      for (const dir of created.splice(0)) {
        await realFs.rm(dir, { recursive: true, force: true });
      }
    });

    const create = async () => {
      const dir = await createReportsRootDir();
      if (dir) created.push(dir);
      return dir;
    };

    // POSIX only: Windows has no mode bits, and the temp dir is per-user there.
    (process.platform === "win32" ? it.skip : it)(
      "hands back a directory no other local account can enter",
      async () => {
        // The report inside is an unredacted screenshot of the user's vault, and
        // on Linux the OS temp dir is shared with every other account.
        const dir = await create();

        expect(dir).not.toBeNull();
        expect((await realFs.stat(dir!)).mode & 0o777).toBe(0o700);
      }
    );

    it("never hands back the same directory twice", async () => {
      // A predictable path can be created first by someone else, and a name
      // planted in it ahead of time is followed by the write that lands there.
      // Two reports in the same second must not collide either.
      const [first, second] = [await create(), await create()];

      expect(first).not.toBeNull();
      expect(second).not.toBe(first);
    });
  });

  describe("removeReportPaths()", () => {
    beforeEach(() => {
      rm.mockReset();
      rm.mockResolvedValue(undefined);
    });

    it("deletes every path it is given, recursively and without failing on absent ones", async () => {
      await removeReportPaths(["/tmp/reports/bundle.zip", "/tmp/reports/bundle"]);

      expect(rm.mock.calls.map(([path]) => path)).toEqual([
        "/tmp/reports/bundle.zip",
        "/tmp/reports/bundle",
      ]);
      expect(rm).toHaveBeenCalledWith("/tmp/reports/bundle.zip", {
        recursive: true,
        force: true,
      });
    });

    it("still deletes the remaining paths after one of them fails", async () => {
      rm.mockRejectedValueOnce(new Error("EBUSY: resource busy or locked"));

      await removeReportPaths(["/tmp/reports/bundle.zip", "/tmp/reports/bundle"]);

      expect(rm.mock.calls.map(([path]) => path)).toEqual([
        "/tmp/reports/bundle.zip",
        "/tmp/reports/bundle",
      ]);
    });

    it("reports back what is still on disk, so the caller can name it (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      // A lock or a virus scanner can refuse the delete, and what stays behind
      // is plaintext prompts and note contents. Swallowing that leaves the user
      // with no way to find the folder — the dialog never names it again.
      rm.mockRejectedValueOnce(new Error("EBUSY: resource busy or locked"));

      await expect(
        removeReportPaths(["/tmp/reports/bundle.zip", "/tmp/reports/bundle"])
      ).resolves.toEqual(["/tmp/reports/bundle.zip"]);
    });

    it("reports nothing left behind when every delete succeeds", async () => {
      await expect(removeReportPaths(["/tmp/reports/bundle"])).resolves.toEqual([]);
    });
  });

  describe("discardReportPaths()", () => {
    beforeEach(() => {
      (Notice as unknown as jest.Mock).mockClear();
    });

    it("says nothing when every path goes", async () => {
      rm.mockResolvedValue(undefined);

      await discardReportPaths(["/tmp/report-a", "/tmp/report-b"]);

      expect(Notice).not.toHaveBeenCalled();
    });

    it("names what is left behind, since nothing else can (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      // The dialog this cleans up after has already closed, so the toast is the
      // only surface left: what survives is the user's prompts and note
      // contents in a folder they have no other way to find.
      rm.mockRejectedValueOnce(new Error("EBUSY")).mockResolvedValue(undefined);

      await discardReportPaths(["/tmp/report-stuck", "/tmp/report-gone"]);

      expect(Notice).toHaveBeenCalledTimes(1);
      const message = (Notice as unknown as jest.Mock).mock.calls[0][0] as string;
      expect(message).toContain("/tmp/report-stuck");
      expect(message).not.toContain("/tmp/report-gone");
    });
  });

  describe("rebuildZip()", () => {
    beforeEach(() => {
      rm.mockReset();
    });

    // Built without the constructor, wiring nothing, because the branch under
    // test reads no state — the same shape `main.test.ts` uses to reach a
    // private method whose collaborators are all module-level.
    const rebuild = (report: PreparedReport) =>
      (
        Object.create(ReportIssueModal.prototype) as unknown as {
          rebuildZip(report: PreparedReport): Promise<PreparedReport>;
        }
      ).rebuildZip(report);

    it("refuses to repack while the stale zip is still there (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      // Deleting the old zip first is the guarantee, not tidying before one: it
      // holds whatever the user just took out of the folder. Repacking over a
      // delete that failed would leave that file sitting there while the page
      // reported a rebuild.
      rm.mockRejectedValue(new Error("EBUSY"));
      const report = {
        folderPath: "/tmp/report-x/bundle",
        zipPath: "/tmp/report-x/bundle.zip",
        attachments: [],
      } as unknown as PreparedReport;

      await expect(rebuild(report)).rejects.toThrow("/tmp/report-x/bundle.zip");
      // One deletion attempt and no more is what says the repack never started:
      // a rebuild that went ahead would fail on the folder and then try to take
      // its own half-written zip back, a second attempt this never reaches.
      expect(rm).toHaveBeenCalledTimes(1);
    });

    it("names a half-written zip the failed repack could not take back (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
      // Preparation sweeps its whole directory when it fails, but a rebuild
      // cannot: the folder is what the user is reviewing. So when the repack
      // fails and its own cleanup fails too, this is the last chance to say
      // where the leftover is.
      rm.mockResolvedValueOnce(undefined).mockRejectedValue(new Error("EBUSY"));
      const report = {
        folderPath: "/tmp/report-y/bundle",
        zipPath: "/tmp/report-y/bundle.zip",
        attachments: [],
      } as unknown as PreparedReport;

      await expect(rebuild(report)).rejects.toThrow("/tmp/report-y/bundle.zip");
    });
  });

  describe("buildReportSourceOptions()", () => {
    const inputs = {
      canCapture: true,
      activityLogOn: true,
      activityLogBytes: 2048,
      debugMode: false,
      activeBackend: "claude",
    };
    const byId = (options: ReturnType<typeof buildReportSourceOptions>, id: ReportSourceId) =>
      options.find((option) => option.id === id);

    it("offers the screenshot checked when there is a pane to photograph", () => {
      const screenshot = byId(buildReportSourceOptions(inputs), "screenshot");

      expect(screenshot?.disabled).toBeFalsy();
      expect(screenshot?.defaultChecked).toBe(true);
      expect(screenshot?.hint).toBeUndefined();
    });

    it("disables the screenshot and names the fix when no pane is open", () => {
      const screenshot = byId(
        buildReportSourceOptions({ ...inputs, canCapture: false }),
        "screenshot"
      );

      // Unchecked as well as disabled: a checked-but-impossible box would spend
      // the user's wait on a bundle whose screenshot.png can only come back
      // empty, which is exactly what this moves off the packing step.
      expect(screenshot?.disabled).toBe(true);
      expect(screenshot?.defaultChecked).toBe(false);
      expect(screenshot?.hint).toBe("open the Agent Mode pane first");
    });

    it("disables the activity log and names the setting when it is turned off", () => {
      const activityLog = byId(
        buildReportSourceOptions({ ...inputs, activityLogOn: false }),
        "activityLog"
      );

      expect(activityLog?.disabled).toBe(true);
      expect(activityLog?.defaultChecked).toBe(false);
      expect(activityLog?.hint).toBe("turn it on in Settings → Advanced");
    });

    it("reports the activity log's size, and says so when nothing is recorded yet", () => {
      expect(byId(buildReportSourceOptions(inputs), "activityLog")?.hint).toBe("2.0 KB");
      expect(
        byId(buildReportSourceOptions({ ...inputs, activityLogBytes: null }), "activityLog")?.hint
      ).toBe("nothing recorded yet");
      // Still in flight: no hint beats briefly claiming the log is missing.
      expect(
        byId(buildReportSourceOptions({ ...inputs, activityLogBytes: undefined }), "activityLog")
          ?.hint
      ).toBeUndefined();
    });

    it("pre-checks the chat log only while Debug Mode is on", () => {
      expect(byId(buildReportSourceOptions(inputs), "chatLog")?.defaultChecked).toBe(false);
      expect(
        byId(buildReportSourceOptions({ ...inputs, debugMode: true }), "chatLog")?.defaultChecked
      ).toBe(true);
    });

    it("offers the opencode log unchecked only when opencode is the active backend", () => {
      expect(byId(buildReportSourceOptions(inputs), "opencodeLog")).toBeUndefined();

      const opencodeLog = byId(
        buildReportSourceOptions({ ...inputs, activeBackend: "opencode" }),
        "opencodeLog"
      );
      // Opt-in: this is opencode's newest global log, so it may carry activity
      // from a session that has nothing to do with the report.
      expect(opencodeLog?.defaultChecked).toBe(false);
      expect(opencodeLog?.hint).toBe("may include unrelated sessions");
    });
  });

  describe("captureBehindOverlay()", () => {
    /**
     * Overlay or pane, identified by which window object it carries. The window
     * also has to keep time, since the settle wait is clocked off the target's.
     */
    function windowStub() {
      return { setTimeout: (fn: () => void, ms?: number) => window.setTimeout(fn, ms) };
    }

    function elementIn(win: object, rect: Partial<DOMRect> = { width: 800, height: 600 }) {
      return {
        win,
        isConnected: true,
        hide: jest.fn(),
        show: jest.fn(),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0, ...rect }),
      } as unknown as HTMLElement & { hide: jest.Mock; show: jest.Mock };
    }

    beforeEach(() => {
      captureViewScreenshot.mockReset();
      captureViewScreenshot.mockResolvedValue(new Uint8Array([1, 2, 3]));
    });

    it("clears Settings out of the frame when it shares the pane's window", async () => {
      const win = windowStub();
      const overlay = elementIn(win);
      const dismissSettings = jest.fn();

      const png = await captureBehindOverlay(overlay, () => elementIn(win), dismissSettings);

      expect(dismissSettings).toHaveBeenCalledTimes(1);
      expect(overlay.hide).toHaveBeenCalledTimes(1);
      // Restored regardless: the flow continues in this dialog afterwards.
      expect(overlay.show).toHaveBeenCalledTimes(1);
      expect(png).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("leaves Settings alone when the pane is in another window", async () => {
      // Obsidian 1.13 gave Settings a window of its own, and this dialog opens
      // from there. Dismissing it would destroy the window running this very
      // code — the report would end here — to remove something no camera aimed
      // at the other window can see.
      const overlay = elementIn(windowStub());
      const dismissSettings = jest.fn();

      const png = await captureBehindOverlay(
        overlay,
        () => elementIn(windowStub()),
        dismissSettings
      );

      expect(dismissSettings).not.toHaveBeenCalled();
      expect(overlay.hide).not.toHaveBeenCalled();
      expect(png).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("skips the screenshot, and every dismissal, when there is no pane", async () => {
      const overlay = elementIn(windowStub());
      const dismissSettings = jest.fn();

      const png = await captureBehindOverlay(overlay, () => null, dismissSettings);

      expect(png).toBeNull();
      expect(dismissSettings).not.toHaveBeenCalled();
      expect(overlay.hide).not.toHaveBeenCalled();
      expect(captureViewScreenshot).not.toHaveBeenCalled();
    });

    it("puts the dialog back when the capture itself fails", async () => {
      const win = windowStub();
      const overlay = elementIn(win);
      captureViewScreenshot.mockRejectedValue(new Error("capturePage failed"));

      await expect(captureBehindOverlay(overlay, () => elementIn(win), jest.fn())).rejects.toThrow(
        "capturePage failed"
      );

      // Otherwise the user is left with a dismissed Settings window and an
      // invisible dialog holding the rest of the flow.
      expect(overlay.show).toHaveBeenCalledTimes(1);
    });
  });

  describe("waitForStableTarget()", () => {
    /**
     * Element whose measured rect the test drives outright, one sample per call.
     * `rects` is walked in order and the last entry repeats, so a case describes
     * an animation as the sequence of rects the pane reports while it plays.
     *
     * Carries its own `win`, because the pane can live in a popout while the
     * report dialog sits in the main renderer — the wait has to be clocked off
     * the element's window, not whichever one happens to be global.
     */
    function targetEl(rects: Array<Partial<DOMRect>>, connected = true) {
      let call = 0;
      const win = {
        setTimeout: (fn: () => void, ms?: number) => window.setTimeout(fn, ms),
        requestAnimationFrame: jest.fn(() => 1),
      };
      const el = {
        win,
        get isConnected() {
          return connected;
        },
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          ...rects[Math.min(call++, rects.length - 1)],
        }),
      } as unknown as HTMLElement;
      return { el, win };
    }

    /** Tracks settlement so a case can assert the wait has NOT finished yet. */
    function watch(promise: Promise<boolean>) {
      const state = { settled: false, value: undefined as boolean | undefined };
      void promise.then((value) => {
        state.settled = true;
        state.value = value;
      });
      return state;
    }

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    /** Advance far enough for the loop to take `samples` geometry readings. */
    const advance = async (samples: number) => {
      for (let i = 0; i < samples; i++) {
        await jest.advanceTimersByTimeAsync(50);
      }
    };

    it("settles once the whole rect repeats", async () => {
      // Mid-animation the pane is still growing, so an early sample must not be
      // trusted even though it already measures non-zero.
      const { el } = targetEl([
        { left: 0, top: 0, width: 0, height: 0 },
        { left: 400, top: 0, width: 120, height: 400 },
        { left: 400, top: 0, width: 300, height: 400 },
        { left: 400, top: 0, width: 300, height: 400 },
      ]);

      const settled = waitForStableTarget(el);
      await advance(4);

      expect(await settled).toBe(true);
    });

    it("keeps waiting while the pane slides at a fixed size", async () => {
      // The reveal animation stops resizing before it stops moving, and
      // `captureViewScreenshot` crops on left/top — so a size-only check would
      // photograph the pane mid-slide, offset from where it lands.
      const { el } = targetEl([
        { left: 900, top: 0, width: 300, height: 400 },
        { left: 700, top: 0, width: 300, height: 400 },
        { left: 500, top: 0, width: 300, height: 400 },
        { left: 400, top: 0, width: 300, height: 400 },
        { left: 400, top: 0, width: 300, height: 400 },
      ]);

      const state = watch(waitForStableTarget(el));
      await advance(3);

      // Three samples in, the size has never changed once — a loop comparing
      // only width and height would already have captured.
      expect(state.settled).toBe(false);

      await advance(2);
      expect(state.value).toBe(true);
    });

    it("gives up as soon as the element leaves the document", async () => {
      const { el } = targetEl([{ left: 0, top: 0, width: 300, height: 400 }], false);

      const settled = waitForStableTarget(el);
      await advance(1);

      // A detached pane can never be photographed, so this must not spend the
      // whole timeout before saying so.
      expect(await settled).toBe(false);
    });

    it("stops waiting on an element that never gains a size", async () => {
      const { el } = targetEl([{ left: 0, top: 0, width: 0, height: 0 }]);

      const settled = waitForStableTarget(el);
      // A collapsed pane would otherwise hold the whole report hostage.
      await advance(30);

      expect(await settled).toBe(false);
    });

    it("finishes on its deadline even when frame callbacks never fire", async () => {
      // A hidden window stops running `requestAnimationFrame` callbacks. The
      // pane can be revealed in a popout while this runs against a backgrounded
      // renderer, so a frame-driven wait would never reach its own deadline and
      // the report would hang with the dialog still hidden.
      // The stub hands back a handle and never runs the callback, so finishing
      // at all is the proof: an implementation may ask for frames, but it must
      // not depend on them arriving. Asserting the outcome rather than banning
      // the call leaves room for a frame-driven wait with a timer fallback.
      const { el } = targetEl([{ left: 0, top: 0, width: 0, height: 0 }]);

      const settled = waitForStableTarget(el);
      await advance(30);

      expect(await settled).toBe(false);
    });
  });

  describe("uploadReport()", () => {
    const report: PreparedReport = {
      folderPath: "/tmp/reports/bundle",
      rootDir: "/tmp/reports",
      zipPath: "/tmp/reports/bundle.zip",
      zipName: "copilot-report-20260615-101500-abcd.zip",
      uploadAttempt: {
        body: new ArrayBuffer(4096),
        idempotencyKey: "5d41c9b2-7e3a-4f8b-9c1d-2a6e8f4b0d37",
      },
      issueDraft: { title: "it exploded", body: "## What went wrong" },
      manualIssueUrl: "https://github.com/logancyang/obsidian-copilot/issues/new?title=manual",
      attachments: [],
    };

    it("sends the packed attempt and builds the linked issue URL from the report id", async () => {
      const uploader: ReportUploader = jest.fn().mockResolvedValue({
        reportId: "9f3c1a7b2e4d5f60819a2b3c4d5e6f70",
        expiresAt: "2026-10-18T00:00:00.000Z",
      });

      const outcome = await uploadReport(uploader, report);

      // The attempt object travels whole: the bytes and the idempotency key
      // were minted as a pair, and splitting them here would let a retry send
      // one half with the other half stale.
      expect(uploader).toHaveBeenCalledWith(report.uploadAttempt);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("expected success");
      const body = new URLSearchParams(outcome.issueUrl.split("?")[1]).get("body") ?? "";
      // Prefixed, not appended: a long body must never be able to push the id
      // out through truncation. And an id, never a URL — the issue is public.
      expect(body.indexOf("9f3c1a7b2e4d5f60819a2b3c4d5e6f70")).toBeLessThan(60);
      expect(body).not.toContain("http");
    });

    it("marks a self-classified rejection as not retryable", async () => {
      const uploader: ReportUploader = jest
        .fn()
        .mockRejectedValue(new ReportUploadError("Allowance used up", false));

      const outcome = await uploadReport(uploader, report);

      expect(outcome).toEqual({ ok: false, error: "Allowance used up", retryable: false });
    });

    it("treats an unclassified rejection as retryable, since the outcome is unknown", async () => {
      // Whatever threw did not say the server refused, so the report may or may
      // not be stored — and re-sending the same attempt is safe either way,
      // because its idempotency key makes a duplicate store impossible.
      const uploader: ReportUploader = jest
        .fn()
        .mockRejectedValue(new Error("Network request failed"));

      const outcome = await uploadReport(uploader, report);

      expect(outcome).toEqual({ ok: false, error: "Network request failed", retryable: true });
    });
  });

  describe("openIssuePageWith()", () => {
    const url = "https://github.com/logancyang/obsidian-copilot/issues/new?title=x";

    beforeEach(() => {
      (Notice as unknown as jest.Mock).mockClear();
    });

    it("opens the page and says nothing when the browser takes it", async () => {
      const openExternal = jest.fn().mockResolvedValue(undefined);

      openIssuePageWith({ openExternal }, url);
      await Promise.resolve();

      expect(openExternal).toHaveBeenCalledWith(url);
      expect(Notice).not.toHaveBeenCalled();
    });

    it("tells the user to open the page themselves when there is no browser bridge", () => {
      openIssuePageWith(null, url);

      expect(Notice).toHaveBeenCalledTimes(1);
    });

    it("repeats the report id in the failure notice, which may be its last carrier", async () => {
      // The note and logs are on the user's machine, but the id exists only in
      // a response whose issue page just failed to open — losing it here means
      // an uploaded report nobody can name.
      const openExternal = jest.fn().mockRejectedValue(new Error("no handler"));

      openIssuePageWith({ openExternal }, url, "9f3c1a7b2e4d5f60819a2b3c4d5e6f70");
      await Promise.resolve();
      await Promise.resolve();

      expect(Notice).toHaveBeenCalledTimes(1);
      const message = (Notice as unknown as jest.Mock).mock.calls[0][0] as string;
      expect(message).toContain("9f3c1a7b2e4d5f60819a2b3c4d5e6f70");
    });

    it("reports a bridge that rejects its promise", async () => {
      const openExternal = jest.fn().mockRejectedValue(new Error("no handler"));

      openIssuePageWith({ openExternal }, url);
      await Promise.resolve();
      await Promise.resolve();

      expect(Notice).toHaveBeenCalledTimes(1);
    });

    it("reports a bridge that throws before returning a promise", () => {
      // The failure shape a bare `.catch()` cannot see. By the time this runs
      // the report is already uploaded, so an escaping error would abandon a
      // page transition that cannot be redone.
      const openExternal = jest.fn(() => {
        throw new Error("bridge disposed");
      });

      expect(() => openIssuePageWith({ openExternal }, url)).not.toThrow();
      expect(Notice).toHaveBeenCalledTimes(1);
    });
  });
});

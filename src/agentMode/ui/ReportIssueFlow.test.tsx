import {
  ReportIssueFlow,
  type PreparedReport,
  type PrepareStep,
  type ReportIssueFlowProps,
  type ReportSourceId,
  type UploadOutcome,
} from "@/agentMode/ui/ReportIssueFlow";
import type { AttachmentOutcome } from "@/utils/issueReport";
import type { ReportUploadResult } from "@/utils/reportUpload";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const included = (id: string, name: string, bytes = 2048): AttachmentOutcome => ({
  id,
  name,
  absPath: `/tmp/reports/bundle/${name}`,
  bytes,
  status: "included",
});

const prepared: PreparedReport = {
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
  attachments: [included("report", "report.md"), included("screenshot", "screenshot.png")],
};

const uploadResult: ReportUploadResult = {
  reportId: "9f3c1a7b2e4d5f60819a2b3c4d5e6f70",
  expiresAt: "2026-08-30T00:00:00.000Z",
};

const linkedIssueUrl = "https://github.com/logancyang/obsidian-copilot/issues/new?title=linked";

function renderFlow(overrides: Partial<ReportIssueFlowProps> = {}) {
  const props: ReportIssueFlowProps = {
    sources: [
      { id: "screenshot", label: "Screenshot of the Agent Mode pane", defaultChecked: true },
      {
        id: "activityLog",
        label: "Agent Mode activity log",
        defaultChecked: true,
        hint: "12.0 MB on disk",
      },
      { id: "chatLog", label: "Regular chat log", defaultChecked: false },
      {
        id: "opencodeLog",
        label: "OpenCode backend log",
        defaultChecked: false,
        disabled: true,
        hint: "Turn it on first.",
      },
    ],
    prepare: jest.fn().mockResolvedValue(prepared),
    rebuildZip: jest.fn().mockResolvedValue(prepared),
    discardReport: jest.fn(),
    upload: jest.fn().mockResolvedValue({
      ok: true,
      result: uploadResult,
      issueUrl: linkedIssueUrl,
    }),
    onCancel: jest.fn(),
    revealFile: jest.fn(),
    openIssuePage: jest.fn(),
    ...overrides,
  };
  return { props, ...render(<ReportIssueFlow {...props} />) };
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Pack the report" }));
}

function checkedStates() {
  return screen.getAllByRole("checkbox").map((box) => box.getAttribute("data-state"));
}

const noteField = () => screen.getByPlaceholderText(/Describe what you were doing/);

const uploadButton = () => screen.getByRole("button", { name: /Upload & open issue|Retry upload/ });

describe("ReportIssueFlow", () => {
  describe("ReportIssueFlow()", () => {
    describe("details step", () => {
      it("starts on the details step with the source defaults and hints applied", () => {
        renderFlow();

        expect(checkedStates()).toEqual(["checked", "checked", "unchecked", "unchecked"]);
        expect(screen.getAllByRole("checkbox")[3].getAttribute("disabled")).not.toBeNull();
        expect(screen.getByText(/12\.0 MB on disk/)).toBeTruthy();
        expect(screen.getByText(/Turn it on first\./)).toBeTruthy();
        // Load-bearing disclosure: what happens next has to be said before the
        // user commits to anything, not discovered on the next page. The copy
        // is maintainer-approved verbatim, so assert its load-bearing halves.
        expect(screen.getByText(/screenshots are not automatically redacted/)).toBeTruthy();
        expect(screen.getByText(/Reports are private and deleted after 60 days/)).toBeTruthy();
      });

      it("passes the note and only the checked sources to the assembler", async () => {
        const prepare = jest.fn().mockResolvedValue(prepared);
        renderFlow({ prepare });

        fireEvent.change(noteField(), { target: { value: "it exploded" } });
        fireEvent.click(screen.getAllByRole("checkbox")[1]);
        fireEvent.click(screen.getAllByRole("checkbox")[2]);
        submit();

        await waitFor(() => expect(prepare).toHaveBeenCalled());
        const [note, selected] = prepare.mock.calls[0] as [string, ReadonlySet<ReportSourceId>];
        expect(note).toBe("it exploded");
        expect([...selected].sort()).toEqual(["chatLog", "screenshot"]);
      });

      it("cancels from the details step without preparing anything", () => {
        const { props } = renderFlow();
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(props.onCancel).toHaveBeenCalled();
        expect(props.prepare).not.toHaveBeenCalled();
      });

      it("returns to the details step with the error and the note kept when preparing fails", async () => {
        const prepare = jest.fn().mockRejectedValue(new Error("The OS temp folder is unavailable"));
        renderFlow({ prepare });

        fireEvent.change(noteField(), { target: { value: "keep me" } });
        submit();

        await waitFor(() => expect(screen.getByText("Could not prepare the report")).toBeTruthy());
        expect(screen.getByText("The OS temp folder is unavailable")).toBeTruthy();
        expect((noteField() as HTMLTextAreaElement).value).toBe("keep me");
        expect(screen.getByRole("button", { name: "Pack the report" })).toBeTruthy();
      });
    });

    describe("review step — packing and the manifest", () => {
      it("shows the review step while packing and fills in the manifest once it lands", async () => {
        renderFlow();

        submit();
        // No separate progress screen to flash: the review step is up from the
        // first frame, with the zip row still pending.
        expect(screen.getByText("Bundle contents")).toBeTruthy();

        await waitFor(() => expect(screen.getByText(prepared.zipName)).toBeTruthy());
        expect(screen.getByText(prepared.zipName)).toBeTruthy();
      });

      it("ticks off each preparation step as the assembler reports it", () => {
        let advance: (step: PrepareStep) => void = () => {};
        const prepare = jest.fn(
          (
            _note: string,
            _selected: ReadonlySet<ReportSourceId>,
            onStep: (s: PrepareStep) => void
          ) =>
            new Promise<PreparedReport>(() => {
              advance = onStep;
            })
        );
        const { container } = renderFlow({ prepare });
        submit();

        const stepStates = () =>
          Array.from(container.querySelectorAll("[data-step]")).map((li) =>
            li.getAttribute("data-state")
          );
        expect(stepStates()).toEqual(["pending", "pending", "pending"]);
        act(() => advance("screenshot"));
        expect(stepStates()).toEqual(["done", "pending", "pending"]);
        act(() => advance("logs"));
        act(() => advance("zip"));
        expect(stepStates()).toEqual(["done", "done", "done"]);
      });

      it("stops updating once the modal closes mid-preparation, and discards the orphaned bundle (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        let resolvePrepare: (report: PreparedReport) => void = () => {};
        const prepare = jest.fn(
          () =>
            new Promise<PreparedReport>((resolve) => {
              resolvePrepare = resolve;
            })
        );
        const discardReport = jest.fn();
        const { unmount } = renderFlow({ prepare, discardReport });

        submit();
        unmount();
        await act(async () => {
          resolvePrepare(prepared);
        });

        // The bundle is plaintext nobody will ever attach, and no UI is left
        // to tell the user where it is.
        expect(discardReport).toHaveBeenCalledWith(prepared);
      });

      it("does not discard anything when preparation fails after the modal closes", async () => {
        let rejectPrepare: (err: Error) => void = () => {};
        const prepare = jest.fn(
          () =>
            new Promise<PreparedReport>((_resolve, reject) => {
              rejectPrepare = reject;
            })
        );
        const discardReport = jest.fn();
        const { unmount } = renderFlow({ prepare, discardReport });

        submit();
        unmount();
        await act(async () => {
          rejectPrepare(new Error("EACCES"));
        });

        expect(discardReport).not.toHaveBeenCalled();
      });

      it("shows the real per-source outcome rather than what the user checked", async () => {
        const prepare = jest.fn().mockResolvedValue({
          ...prepared,
          attachments: [
            included("report", "report.md"),
            included("screenshot", "screenshot.png"),
            {
              id: "activityLog",
              name: "acp-frames.ndjson.txt",
              absPath: null,
              bytes: 0,
              status: "skipped" as const,
              reason: "The Agent Mode activity log is turned off.",
            },
            {
              id: "chatLog",
              name: "copilot-chat-log.md",
              absPath: null,
              bytes: 0,
              status: "failed" as const,
              reason: "EACCES",
            },
          ],
        });
        renderFlow({ prepare });
        submit();

        await waitFor(() => expect(screen.getByText("acp-frames.ndjson.txt")).toBeTruthy());
        expect(screen.getByText("The Agent Mode activity log is turned off.")).toBeTruthy();
        expect(screen.getByText("EACCES")).toBeTruthy();
        expect(screen.getAllByText("2.0 KB").length).toBe(2);
      });

      it("marks a truncated attachment in the outcome list", async () => {
        const prepare = jest.fn().mockResolvedValue({
          ...prepared,
          attachments: [{ ...included("activityLog", "acp-frames.ndjson.txt"), truncated: true }],
        });
        renderFlow({ prepare });
        submit();

        await waitFor(() => expect(screen.getByText("2.0 KB · truncated to newest")).toBeTruthy());
      });
    });

    describe("review step — upload", () => {
      it("holds Upload until the zip exists, and does not upload until clicked", async () => {
        let resolvePrepare: (report: PreparedReport) => void = () => {};
        const prepare = jest.fn(
          () =>
            new Promise<PreparedReport>((resolve) => {
              resolvePrepare = resolve;
            })
        );
        const { props } = renderFlow({ prepare });
        submit();

        expect(uploadButton().getAttribute("disabled")).not.toBeNull();

        await act(async () => {
          resolvePrepare(prepared);
        });

        expect(uploadButton().getAttribute("disabled")).toBeNull();
        // Packing alone must never trigger an upload — it needs its own click.
        expect(props.upload).not.toHaveBeenCalled();
      });

      it("uploads on click, opens the issue once, and moves to the done page", async () => {
        const { props } = renderFlow();
        submit();
        await waitFor(() => expect(screen.getByText(prepared.zipName)).toBeTruthy());

        fireEvent.click(uploadButton());

        await waitFor(() => expect(screen.getByText("Report uploaded")).toBeTruthy());
        expect(props.upload).toHaveBeenCalledWith(prepared);
        expect(props.openIssuePage).toHaveBeenCalledTimes(1);
        // The id rides along so a host whose browser fails can still surface it.
        expect(props.openIssuePage).toHaveBeenCalledWith(linkedIssueUrl, uploadResult.reportId);
      });

      it("shows the failure, offers retry and the manual fallback, and keeps the zip on disk", async () => {
        const upload = jest
          .fn()
          .mockResolvedValue({ ok: false, error: "Network request failed", retryable: true });
        const { props } = renderFlow({ upload });
        submit();
        await waitFor(() => expect(screen.getByText(prepared.zipName)).toBeTruthy());

        fireEvent.click(uploadButton());

        await waitFor(() => expect(screen.getByText("Could not upload the report")).toBeTruthy());
        expect(screen.getByText(/Network request failed/)).toBeTruthy();
        // Why Retry is safe is the user's deciding information: the same
        // attempt is stored at most once, so retrying cannot duplicate it.
        expect(screen.getByText(/stores it at most once/)).toBeTruthy();
        // The escape hatch has to say what it costs: the issue it opens has no
        // report ID, so the user is on the hook for attaching the zip themselves.
        expect(screen.getByText(/carries no report ID/)).toBeTruthy();
        expect(screen.getByText(/attach the zip to it yourself/)).toBeTruthy();
        expect(props.openIssuePage).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "Open issue anyway" }));
        expect(props.openIssuePage).toHaveBeenCalledWith(prepared.manualIssueUrl);

        // The failed upload did not consume the zip — it is still there to retry.
        expect(
          screen.getByRole("button", { name: "Retry upload" }).getAttribute("disabled")
        ).toBeNull();
      });

      it("withholds Retry after a definitive rejection, keeping only the paths that can differ", async () => {
        // A rejection (quota spent, bundle refused) fails identically on the
        // same bytes while still spending the upload allowance — so the only
        // buttons left are ones that change something: Rebuild makes a new zip,
        // and the manual path sidesteps the upload entirely.
        const upload = jest
          .fn()
          .mockResolvedValue({ ok: false, error: "Allowance used up", retryable: false });
        renderFlow({ upload });
        submit();
        await waitFor(() => expect(screen.getByText(prepared.zipName)).toBeTruthy());

        fireEvent.click(uploadButton());
        await waitFor(() => expect(screen.getByText("Could not upload the report")).toBeTruthy());

        expect(
          screen.queryByRole("button", { name: /Retry upload|Upload & open issue/ })
        ).toBeNull();
        // No retry-safety promise either: with no Retry on offer, "stores it at
        // most once" would be reassurance about an action the page just removed.
        expect(screen.queryByText(/stores it at most once/)).toBeNull();
        expect(screen.getByRole("button", { name: "Open issue anyway" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Rebuild zip" })).toBeTruthy();
      });

      it("uploads again on Retry and finishes on the second attempt", async () => {
        // The first failure must leave the flow able to try again, not merely
        // showing a button: the single-flight lock is released in a `finally`,
        // and a lock left held would make Retry silently do nothing.
        const upload = jest
          .fn()
          .mockResolvedValueOnce({ ok: false, error: "Network request failed", retryable: true })
          .mockResolvedValueOnce({ ok: true, result: uploadResult, issueUrl: linkedIssueUrl });
        const { props } = renderFlow({ upload });
        submit();
        await waitFor(() => expect(screen.getByText(prepared.zipName)).toBeTruthy());

        fireEvent.click(uploadButton());
        await waitFor(() => expect(screen.getByText("Could not upload the report")).toBeTruthy());

        fireEvent.click(screen.getByRole("button", { name: "Retry upload" }));

        await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
        expect(props.openIssuePage).toHaveBeenCalledWith(linkedIssueUrl, uploadResult.reportId);
      });

      it("replaces the upload control with a spinner on click, so a second click has nothing to hit", async () => {
        let resolveUpload: (outcome: UploadOutcome) => void = () => {};
        const upload = jest.fn(
          () =>
            new Promise<UploadOutcome>((resolve) => {
              resolveUpload = resolve;
            })
        );
        renderFlow({ upload });
        submit();
        await waitFor(() => expect(screen.getByText(prepared.zipName)).toBeTruthy());

        fireEvent.click(uploadButton());

        expect(upload).toHaveBeenCalledTimes(1);
        expect(
          screen.queryByRole("button", { name: /Upload & open issue|Retry upload/ })
        ).toBeNull();

        await act(async () => {
          resolveUpload({ ok: true, result: uploadResult, issueUrl: linkedIssueUrl });
        });
      });

      it("still opens the prefilled issue when the modal closes before the upload lands (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        let resolveUpload: (outcome: UploadOutcome) => void = () => {};
        const upload = jest.fn(
          () =>
            new Promise<UploadOutcome>((resolve) => {
              resolveUpload = resolve;
            })
        );
        const { props, unmount } = renderFlow({ upload });
        submit();
        await waitFor(() => expect(screen.getByText(prepared.zipName)).toBeTruthy());

        fireEvent.click(uploadButton());
        await waitFor(() => expect(upload).toHaveBeenCalled());

        unmount();
        await act(async () => {
          resolveUpload({ ok: true, result: uploadResult, issueUrl: linkedIssueUrl });
        });

        // The upload cannot be aborted, so dismissing the dialog does not undo
        // it. The report is on the server; withholding the report ID would
        // leave the user with an upload they can neither see nor use.
        expect(props.openIssuePage).toHaveBeenCalledWith(linkedIssueUrl, uploadResult.reportId);
      });

      it("stays quiet when the upload fails after the modal closes", async () => {
        // The mirror of the case above, and the reason the success path cannot
        // just drop its mounted check: a late failure has no surface left to
        // report on, so it must not open a browser or write state into an
        // unmounted tree.
        let rejectUpload: (outcome: UploadOutcome) => void = () => {};
        const upload = jest.fn(
          () =>
            new Promise<UploadOutcome>((resolve) => {
              rejectUpload = resolve;
            })
        );
        const { props, unmount } = renderFlow({ upload });
        submit();
        await waitFor(() => expect(screen.getByText(prepared.zipName)).toBeTruthy());

        fireEvent.click(uploadButton());
        await waitFor(() => expect(upload).toHaveBeenCalled());

        unmount();
        await act(async () => {
          rejectUpload({ ok: false, error: "Network request failed", retryable: true });
        });

        expect(props.openIssuePage).not.toHaveBeenCalled();
      });

      it("shows a spinner in place of the button row while uploading", async () => {
        let resolveUpload: (outcome: UploadOutcome) => void = () => {};
        const upload = jest.fn(
          () =>
            new Promise<UploadOutcome>((resolve) => {
              resolveUpload = resolve;
            })
        );
        const { container } = renderFlow({ upload });
        submit();
        await waitFor(() => expect(screen.getByText(prepared.zipName)).toBeTruthy());

        fireEvent.click(uploadButton());
        await waitFor(() => expect(screen.getByText(/Uploading — this can/)).toBeTruthy());
        // An actual spinner, not just a label: the upload has no progress to
        // report, so motion is the only thing telling the user it is alive.
        expect(container.querySelector(".tw-animate-spin")).not.toBeNull();
        // The button row itself is replaced by the spinner while uploading, so
        // there is nothing left to click — Rebuild is gone, not merely disabled.
        expect(screen.queryByRole("button", { name: "Rebuild zip" })).toBeNull();
        // Only the button row goes. The manifest is what the user just approved
        // sending, and it has to stay legible while that send is in flight.
        expect(screen.getByText(prepared.zipName)).toBeTruthy();
        expect(screen.getByText("report.md")).toBeTruthy();

        await act(async () => {
          resolveUpload({ ok: true, result: uploadResult, issueUrl: linkedIssueUrl });
        });
      });

      it("disables Upload while a rebuild is in flight or has failed", async () => {
        let resolveRebuild: (report: PreparedReport) => void = () => {};
        const rebuildZip = jest.fn(
          () =>
            new Promise<PreparedReport>((resolve) => {
              resolveRebuild = resolve;
            })
        );
        renderFlow({ rebuildZip });
        submit();
        await waitFor(() => expect(screen.getByText(prepared.zipName)).toBeTruthy());

        fireEvent.click(screen.getByRole("button", { name: "Rebuild zip" }));
        expect(uploadButton().getAttribute("disabled")).not.toBeNull();

        await act(async () => {
          resolveRebuild(prepared);
        });
        expect(uploadButton().getAttribute("disabled")).toBeNull();
      });

      it("clears a stale upload failure once a rebuild succeeds", async () => {
        const upload = jest
          .fn()
          .mockResolvedValue({ ok: false, error: "Network request failed", retryable: true });
        renderFlow({ upload });
        submit();
        await waitFor(() => expect(screen.getByText(prepared.zipName)).toBeTruthy());

        fireEvent.click(uploadButton());
        await waitFor(() => expect(screen.getByText("Could not upload the report")).toBeTruthy());

        fireEvent.click(screen.getByRole("button", { name: "Rebuild zip" }));
        await waitFor(() => expect(screen.queryByText("Could not upload the report")).toBeNull());
        expect(screen.getByRole("button", { name: "Upload & open issue" })).toBeTruthy();
      });
    });

    describe("review step — rebuild", () => {
      it("withholds Upload and names the fix after a failed rebuild", async () => {
        const rebuildZip = jest.fn().mockRejectedValue(new Error("ENOENT: report.md"));
        renderFlow({ rebuildZip });
        submit();
        await waitFor(() => expect(screen.getByText(prepared.zipName)).toBeTruthy());

        fireEvent.click(screen.getByRole("button", { name: "Rebuild zip" }));

        await waitFor(() => expect(screen.getByText("Could not rebuild the zip")).toBeTruthy());
        expect(uploadButton().getAttribute("disabled")).not.toBeNull();
      });

      it("shows the rebuilt zip's size and the refreshed size of every attachment", async () => {
        const rebuildZip = jest.fn().mockResolvedValue({
          ...prepared,
          uploadAttempt: {
            body: new ArrayBuffer(1024),
            idempotencyKey: "e8b7a6c5-d4f3-4a2b-8c1d-9e0f1a2b3c4d",
          },
          attachments: [included("report", "report.md", 512)],
        });
        renderFlow({ rebuildZip });
        submit();
        await waitFor(() => expect(screen.getByText(prepared.zipName)).toBeTruthy());

        fireEvent.click(screen.getByRole("button", { name: "Rebuild zip" }));

        await waitFor(() => expect(screen.getByText("1.0 KB")).toBeTruthy());
        expect(rebuildZip).toHaveBeenCalledWith(prepared);
        // The listed attachments describe the zip that exists now, not the one
        // it replaced, so the manifest cannot drift from the file.
        expect(screen.getByText("512 B")).toBeTruthy();
        expect(screen.queryByText("screenshot.png")).toBeNull();
      });

      it("withdraws the zip while a rebuild is in flight, since the old one is already gone", async () => {
        const rebuildZip = jest.fn(() => new Promise<PreparedReport>(() => {}));
        renderFlow({ rebuildZip });
        submit();
        await waitFor(() => expect(screen.getByText(prepared.zipName)).toBeTruthy());

        fireEvent.click(screen.getByRole("button", { name: "Rebuild zip" }));

        await waitFor(() =>
          expect(screen.getByRole("button", { name: "Rebuilding…" })).toBeTruthy()
        );
        expect(screen.queryByText(prepared.zipName)).toBeNull();
      });

      it("refuses to hand over the stale zip after a failed rebuild and keeps the files", async () => {
        const rebuildZip = jest.fn().mockRejectedValue(new Error("ENOENT: report.md"));
        const { props } = renderFlow({ rebuildZip });
        submit();
        await waitFor(() => expect(screen.getByText(prepared.zipName)).toBeTruthy());

        fireEvent.click(screen.getByRole("button", { name: "Rebuild zip" }));

        await waitFor(() => expect(screen.getByText("Could not rebuild the zip")).toBeTruthy());
        expect(screen.queryByText(prepared.zipName)).toBeNull();

        // "Show in folder" falls back to the staging folder, which survives a
        // failed rebuild so the user can fix what broke it.
        fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));
        expect(props.revealFile).toHaveBeenCalledWith(prepared.folderPath);
      });
    });

    describe("done step", () => {
      async function reachDone(overrides: Partial<ReportIssueFlowProps> = {}) {
        const result = renderFlow(overrides);
        submit();
        await waitFor(() => expect(screen.getByText(prepared.zipName)).toBeTruthy());
        fireEvent.click(uploadButton());
        await waitFor(() => expect(screen.getByText("Report uploaded")).toBeTruthy());
        return result;
      }

      it("shows the uploaded bundle, the report ID, and the expiry", async () => {
        await reachDone();

        expect(screen.getByText("report.md")).toBeTruthy();
        expect(screen.getByText(prepared.zipName)).toBeTruthy();
        // The id is quoted for copying, never rendered as a link: there is
        // nothing to download, and the issue must carry only the id.
        expect(screen.getByText(uploadResult.reportId)).toBeTruthy();
        expect(screen.getByText(/Report expires/)).toBeTruthy();
        // Filing an issue is not the only way to use the id, and a reader who
        // is heading for chat instead has no other cue that it means anything
        // there.
        expect(screen.getByText(/paste this ID in Discord/)).toBeTruthy();
        expect(screen.getByText(/Nothing is filed until you press Submit/)).toBeTruthy();
      });

      it("lets the user reveal the zip and reopen the issue", async () => {
        const { props } = await reachDone();

        fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));
        expect(props.revealFile).toHaveBeenCalledWith(prepared.zipPath);

        fireEvent.click(screen.getByRole("button", { name: "Open the issue" }));
        // Once from the automatic open on success, once from this click.
        expect(props.openIssuePage).toHaveBeenCalledTimes(2);
        expect(props.openIssuePage).toHaveBeenLastCalledWith(linkedIssueUrl, uploadResult.reportId);
      });
    });
  });
});

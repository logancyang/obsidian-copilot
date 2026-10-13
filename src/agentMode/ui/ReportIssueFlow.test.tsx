import {
  ReportIssueFlow,
  type PreparedReport,
  type ReportIssueFlowProps,
  type ReportSourceId,
  type UploadOutcome,
} from "@/agentMode/ui/ReportIssueFlow";
import type { AttachmentResult } from "@/utils/issueReport";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const included = (id: string, name: string, bytes = 2048): AttachmentResult => ({
  id,
  name,
  bytes,
  included: true,
});

const prepared: PreparedReport = {
  zipDir: "/tmp/reports",
  zipPath: "/tmp/reports/copilot-report-20260615-101500-abcd.zip",
  zipName: "copilot-report-20260615-101500-abcd.zip",
  uploadAttempt: {
    body: new ArrayBuffer(4096),
    idempotencyKey: "5d41c9b2-7e3a-4f8b-9c1d-2a6e8f4b0d37",
  },
  issueDraft: { title: "it exploded", body: "## What went wrong" },
  manualIssueUrl: "https://github.com/logancyang/obsidian-copilot/issues/new?title=manual",
  attachments: [included("report", "report.md"), included("screenshot", "screenshot.png")],
};

const uploaded: UploadOutcome = {
  ok: true,
  reportId: "9f3c1a7b2e4d5f60819a2b3c4d5e6f70",
  issueUrl: "https://github.com/logancyang/obsidian-copilot/issues/new?title=linked",
};

const failed: UploadOutcome = { ok: false, error: "Network request failed" };

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (err: Error) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderFlow(overrides: Partial<ReportIssueFlowProps> = {}) {
  const props: ReportIssueFlowProps = {
    sources: [
      { id: "screenshot", label: "Screenshot of the Agent Mode pane", defaultChecked: true },
      {
        id: "activityLog",
        label: "Agent Mode activity log",
        description: "Newest 2 MB of the log",
        defaultChecked: true,
      },
      { id: "chatLog", label: "Copilot log", defaultChecked: false },
      { id: "opencodeLog", label: "OpenCode backend log", defaultChecked: false },
    ],
    prepare: jest.fn().mockResolvedValue(prepared),
    upload: jest.fn().mockResolvedValue(uploaded),
    discardReport: jest.fn().mockResolvedValue(undefined),
    onCancel: jest.fn(),
    onUploaded: jest.fn(),
    openIssuePage: jest.fn(),
    revealFile: jest.fn(),
    ...overrides,
  };
  return { props, ...render(<ReportIssueFlow {...props} />) };
}

const submit = () => fireEvent.click(screen.getByRole("button", { name: "Prepare report" }));

const noteField = () => screen.getByPlaceholderText(/Describe what you were doing/);

const uploadButton = () => screen.getByRole("button", { name: /Upload & open issue|Retry upload/ });

const checkedStates = () =>
  screen.getAllByRole("checkbox").map((box) => box.getAttribute("data-state"));

async function awaitPrepared() {
  await waitFor(() => expect(screen.getByText(prepared.zipName)).toBeTruthy());
}

async function reachFailedUpload(overrides: Partial<ReportIssueFlowProps> = {}) {
  const rendered = renderFlow({ upload: jest.fn().mockResolvedValue(failed), ...overrides });
  submit();
  await awaitPrepared();
  fireEvent.click(uploadButton());
  await waitFor(() => expect(screen.getByText("Could not upload the report")).toBeTruthy());
  return rendered;
}

describe("ReportIssueFlow", () => {
  describe("ReportIssueFlow()", () => {
    describe("details page", () => {
      it("starts with the source defaults applied and the descriptions and consent copy visible", () => {
        renderFlow();

        expect(checkedStates()).toEqual(["checked", "checked", "unchecked", "unchecked"]);
        expect(screen.getByText("Newest 2 MB of the log")).toBeTruthy();
        expect(screen.getByText(/screenshots are not automatically redacted/)).toBeTruthy();
        expect(screen.getByText(/Reports are private and deleted after 60 days/)).toBeTruthy();
      });

      it("starts with a feedback card's draft in the note field, still editable before it is sent", async () => {
        const { props } = renderFlow({ initialNote: "Replied in Swedish\n\nWhat happened: hej" });

        expect((noteField() as HTMLTextAreaElement).value).toBe(
          "Replied in Swedish\n\nWhat happened: hej"
        );
        fireEvent.change(noteField(), { target: { value: "Replied in Swedish, edited" } });
        submit();
        await awaitPrepared();
        expect(props.prepare).toHaveBeenCalledWith("Replied in Swedish, edited", expect.any(Set));
      });

      it("passes the note and only the checked sources to prepare", async () => {
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

      it("cancels without preparing anything", () => {
        const { props } = renderFlow();
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(props.onCancel).toHaveBeenCalled();
        expect(props.prepare).not.toHaveBeenCalled();
      });

      it("returns to the details page with the error and the note kept when preparing fails", async () => {
        const prepare = jest.fn().mockRejectedValue(new Error("The OS temp folder is unavailable"));
        renderFlow({ prepare });

        fireEvent.change(noteField(), { target: { value: "keep me" } });
        submit();

        await waitFor(() => expect(screen.getByText("Could not prepare the report")).toBeTruthy());
        expect(screen.getByText("The OS temp folder is unavailable")).toBeTruthy();
        expect((noteField() as HTMLTextAreaElement).value).toBe("keep me");
        expect(screen.getByRole("button", { name: "Prepare report" })).toBeTruthy();
      });
    });

    describe("preparing", () => {
      it("shows the review page from the first frame and fills in the manifest once prepare lands", async () => {
        renderFlow();

        submit();
        expect(screen.getByText("Report contents")).toBeTruthy();
        expect(screen.getByRole("status").textContent).toBe("Preparing report…");

        await awaitPrepared();
        expect(screen.queryByRole("status")).toBeNull();
        expect(screen.getByText("4.0 KB")).toBeTruthy();
      });

      it("holds Upload until the report exists and does not upload until clicked", async () => {
        const pending = deferred<PreparedReport>();
        const { props } = renderFlow({ prepare: jest.fn(() => pending.promise) });
        submit();

        expect(uploadButton().getAttribute("disabled")).not.toBeNull();

        await act(async () => pending.resolve(prepared));

        expect(uploadButton().getAttribute("disabled")).toBeNull();
        expect(props.upload).not.toHaveBeenCalled();
      });

      it("discards a report that finishes preparing after the dialog closed (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        const pending = deferred<PreparedReport>();
        const discardReport = jest.fn().mockResolvedValue(undefined);
        const { unmount } = renderFlow({ prepare: jest.fn(() => pending.promise), discardReport });

        submit();
        unmount();
        await act(async () => pending.resolve(prepared));

        expect(discardReport).toHaveBeenCalledWith(prepared);
      });

      it("does not discard anything when preparation fails after the dialog closed", async () => {
        const pending = deferred<PreparedReport>();
        const discardReport = jest.fn().mockResolvedValue(undefined);
        const { unmount } = renderFlow({ prepare: jest.fn(() => pending.promise), discardReport });

        submit();
        unmount();
        await act(async () => pending.reject(new Error("EACCES")));

        expect(discardReport).not.toHaveBeenCalled();
      });
    });

    describe("review page", () => {
      it("lists one line per attachment from the prepared manifest, with size and note", async () => {
        const prepare = jest.fn().mockResolvedValue({
          ...prepared,
          attachments: [
            included("report", "report.md"),
            {
              ...included("activityLog", "acp-frames.ndjson.txt"),
              note: "truncated to the newest entries of 40 MB",
            },
            {
              id: "chatLog",
              name: "copilot-log.md",
              bytes: 0,
              included: false,
              note: "failed: EACCES",
            },
          ],
        });
        renderFlow({ prepare });
        submit();

        await waitFor(() => expect(screen.getByText("acp-frames.ndjson.txt")).toBeTruthy());
        expect(screen.getByText("copilot-log.md")).toBeTruthy();
        expect(screen.getByText("failed: EACCES")).toBeTruthy();
        expect(screen.getByText("truncated to the newest entries of 40 MB")).toBeTruthy();
        expect(screen.getAllByText("2.0 KB").length).toBe(2);
        expect(screen.queryByText("screenshot.png")).toBeNull();
      });

      it("reveals the zip that is about to be uploaded", async () => {
        const { props } = renderFlow();
        submit();
        await awaitPrepared();

        fireEvent.click(screen.getByRole("button", { name: "Show zip" }));

        expect(props.revealFile).toHaveBeenCalledWith(prepared.zipPath);
      });

      it("discards the prepared report and cancels when Cancel is pressed", async () => {
        const { props } = renderFlow();
        submit();
        await awaitPrepared();

        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(props.discardReport).toHaveBeenCalledWith(prepared);
        expect(props.onCancel).toHaveBeenCalled();
        expect(props.upload).not.toHaveBeenCalled();
      });

      it("uploads on click and hands the result to the host once, with no page of its own (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        const { props } = renderFlow();
        submit();
        await awaitPrepared();

        fireEvent.click(uploadButton());

        await waitFor(() => expect(props.onUploaded).toHaveBeenCalledTimes(1));
        expect(props.upload).toHaveBeenCalledWith(prepared);
        expect(props.onUploaded).toHaveBeenCalledWith({
          reportId: uploaded.reportId,
          issueUrl: uploaded.issueUrl,
        });
        expect(props.openIssuePage).not.toHaveBeenCalled();
        expect(screen.queryByText(/Report uploaded/)).toBeNull();
        expect(screen.getByText(prepared.zipName)).toBeTruthy();
      });

      it("shows a spinner in place of the actions while uploading, with nothing left to cancel", async () => {
        const pending = deferred<UploadOutcome>();
        const { container } = renderFlow({ upload: jest.fn(() => pending.promise) });
        submit();
        await awaitPrepared();

        fireEvent.click(uploadButton());
        await waitFor(() => expect(screen.getByText(/Uploading — this can/)).toBeTruthy());
        expect(container.querySelector(".tw-animate-spin")).not.toBeNull();
        expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
        expect(screen.queryByRole("button", { name: /Upload & open issue/ })).toBeNull();
        expect(screen.getByText("report.md")).toBeTruthy();

        await act(async () => pending.resolve(uploaded));
      });

      it("ignores an upload result that arrives after the dialog closed (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        const pending = deferred<UploadOutcome>();
        const { props, unmount } = renderFlow({ upload: jest.fn(() => pending.promise) });
        submit();
        await awaitPrepared();

        fireEvent.click(uploadButton());
        await waitFor(() => expect(props.upload).toHaveBeenCalled());

        unmount();
        await act(async () => pending.resolve(uploaded));

        expect(props.onUploaded).not.toHaveBeenCalled();
      });
    });

    describe("upload failure", () => {
      it("offers Retry, Show zip and Open issue anyway for every failure, and keeps the zip (https://github.com/Brevilabs/obsidian-copilot-private/issues/202)", async () => {
        const { props } = await reachFailedUpload();

        expect(screen.getByText(/Network request failed/)).toBeTruthy();
        expect(screen.getByText(/attach the zip to it yourself/)).toBeTruthy();
        expect(
          screen.getByRole("button", { name: "Retry upload" }).getAttribute("disabled")
        ).toBeNull();
        expect(screen.getByRole("button", { name: "Show zip" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Open issue anyway" })).toBeTruthy();
        expect(props.onUploaded).not.toHaveBeenCalled();
        expect(screen.getByText(prepared.zipName)).toBeTruthy();
      });

      it("re-sends the very same upload attempt on Retry rather than repacking", async () => {
        const upload = jest.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce(uploaded);
        const { props } = await reachFailedUpload({ upload });

        fireEvent.click(screen.getByRole("button", { name: "Retry upload" }));

        await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
        expect(upload.mock.calls[1][0].uploadAttempt).toBe(prepared.uploadAttempt);
        expect(props.prepare).toHaveBeenCalledTimes(1);
        expect(props.onUploaded).toHaveBeenCalledWith({
          reportId: uploaded.reportId,
          issueUrl: uploaded.issueUrl,
        });
      });

      it("opens the no-ID issue on Open issue anyway and stays on the failed state", async () => {
        const { props } = await reachFailedUpload();

        fireEvent.click(screen.getByRole("button", { name: "Open issue anyway" }));

        expect(props.openIssuePage).toHaveBeenCalledWith(prepared.manualIssueUrl);
        expect(props.onCancel).not.toHaveBeenCalled();
        expect(screen.getByText("Could not upload the report")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Retry upload" })).toBeTruthy();
      });

      it("clears the failure while a retry is in flight", async () => {
        const second = deferred<UploadOutcome>();
        const upload = jest.fn().mockResolvedValueOnce(failed).mockReturnValueOnce(second.promise);
        await reachFailedUpload({ upload });

        fireEvent.click(screen.getByRole("button", { name: "Retry upload" }));

        await waitFor(() => expect(screen.getByText(/Uploading — this can/)).toBeTruthy());
        expect(screen.queryByText("Could not upload the report")).toBeNull();

        await act(async () => second.resolve(uploaded));
      });
    });
  });
});

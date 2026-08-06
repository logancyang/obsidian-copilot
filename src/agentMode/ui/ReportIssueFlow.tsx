/**
 * The "Report an issue" wizard UI: details form, then pack & review, then a
 * confirmation once the upload has landed. Deliberately free of Electron,
 * Node, and Obsidian singletons: every capability it needs (capture,
 * assemble, zip, upload, reveal, open browser) arrives as a prop from
 * `ReportIssueModal`, so the whole flow can be driven in a unit test.
 */

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/chat-components/CopyButton";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/utils/formatBytes";
import { type AttachmentOutcome, type ReportIssueDraft } from "@/utils/issueReport";
import { type ReportUploadResult } from "@/utils/reportUpload";
import { AlertTriangle, Check, CircleSlash, FileArchive, Loader2, X } from "lucide-react";
import React from "react";

/** The optional attachments the user can opt into, keyed for stable rendering. */
export type ReportSourceId = "screenshot" | "activityLog" | "chatLog" | "opencodeLog";

export interface ReportSourceOption {
  id: ReportSourceId;
  label: string;
  /** Muted note rendered inline after the label — a size, or why it is unavailable. */
  hint?: string;
  defaultChecked: boolean;
  /** Listed but not selectable; `hint` must then explain how to enable it. */
  disabled?: boolean;
}

export type PrepareStep = "screenshot" | "logs" | "zip";
type ReportPhase = "details" | "review" | "done";

export interface PreparedReport {
  /** Staging folder, kept on disk so the user can inspect what they are sharing. */
  folderPath: string;
  /**
   * Private directory holding the staging folder and the zip, and nothing else.
   * Discarding the report removes this rather than its contents, so no empty
   * wrapper is left behind in the OS temp folder.
   */
  rootDir: string;
  zipPath: string;
  zipName: string;
  zipBytes: number;
  /** Title/body the linked issue URL is built from once upload succeeds. */
  issueDraft: ReportIssueDraft;
  /** No-link fallback URL, opened when the user attaches the zip by hand. */
  manualIssueUrl: string;
  attachments: AttachmentOutcome[];
}

/**
 * What `upload` resolves to — the flow renders either outcome, nothing more.
 *
 * `ok: true` means the report reached the server, which is irreversible: the
 * only failure it can still carry is `linkPrefilled: false`, meaning the issue
 * URL could not be built with the link in it and the user has to paste it.
 * A local failure after a successful upload must never come back as `ok: false`,
 * or the UI would offer a Retry that uploads a second copy.
 */
export type UploadOutcome = UploadSuccess | { ok: false; error: string };

/** The successful half of `UploadOutcome`, which the done page renders from. */
export interface UploadSuccess {
  ok: true;
  result: ReportUploadResult;
  issueUrl: string;
  /**
   * Whether `issueUrl` carries the link. False when the report uploaded but the
   * prefilled URL could not be assembled, so the user must paste it themselves.
   * Absent means true — the ordinary case.
   */
  linkPrefilled?: boolean;
}

export interface ReportIssueFlowProps {
  sources: ReportSourceOption[];
  prepare: (
    note: string,
    selected: ReadonlySet<ReportSourceId>,
    onStep: (step: PrepareStep) => void
  ) => Promise<PreparedReport>;
  /**
   * Repack the staging folder as it stands now. The only way an edit the user
   * made there can reach the zip, which was packed before they saw it.
   */
  rebuildZip: (report: PreparedReport) => Promise<PreparedReport>;
  /**
   * Delete a bundle nobody will send. Called when a report finishes preparing
   * after the modal is gone; a bundle that reached the review step is the user's
   * to review and outlives the modal on purpose.
   */
  discardReport: (report: PreparedReport) => void;
  /** Upload the packed zip and build the linked issue URL. */
  upload: (report: PreparedReport) => Promise<UploadOutcome>;
  onCancel: () => void;
  revealFile: (path: string) => void;
  openIssuePage: (url: string) => void;
}

/**
 * The stages of `prepare`, in order. Labels name the stage, never a product:
 * the screenshot stage runs even when the user did not ask for one and a log
 * source can come back empty, so only the review step's real
 * `AttachmentOutcome` list may say what the bundle actually contains. A tick
 * here means "this stage finished", nothing more.
 */
const PREPARE_STEPS: Array<{ id: PrepareStep; label: string }> = [
  { id: "screenshot", label: "Screenshot" },
  { id: "logs", label: "Logs" },
  { id: "zip", label: "Single zip file" },
];

/** The three pages, in order, for the stepper at the top of every page. */
const PAGE_LABELS: Record<ReportPhase, string> = {
  details: "What to include",
  review: "Pack & review",
  done: "Submit",
};
const PHASE_ORDER: ReportPhase[] = ["details", "review", "done"];

export function ReportIssueFlow(props: ReportIssueFlowProps) {
  const { sources, prepare, discardReport, upload } = props;
  const [phase, setPhase] = React.useState<ReportPhase>("details");
  const [note, setNote] = React.useState("");
  const [selected, setSelected] = React.useState<Set<ReportSourceId>>(
    () => new Set(sources.filter((s) => s.defaultChecked && !s.disabled).map((s) => s.id))
  );
  const [completedSteps, setCompletedSteps] = React.useState<Set<PrepareStep>>(() => new Set());
  const [report, setReport] = React.useState<PreparedReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<UploadSuccess | null>(null);

  // `prepare` outlives the modal when the user hits ESC mid-preparation. Nothing
  // it produces afterwards may reach the host: reaching "done" past that point
  // would open a browser tab the user just cancelled.
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleSubmit = async () => {
    setError(null);
    setCompletedSteps(new Set());
    setPhase("review");
    try {
      const prepared = await prepare(note, selected, (step) => {
        if (!mountedRef.current) return;
        setCompletedSteps((done) => new Set(done).add(step));
      });
      if (!mountedRef.current) {
        // Nobody will ever upload this bundle, and it is plaintext prompts and
        // note contents sitting in the OS temp folder with no UI left to name it.
        discardReport(prepared);
        return;
      }
      setReport(prepared);
    } catch (err) {
      if (!mountedRef.current) return;
      // A failed bundle must not reach the review step: there would be nothing
      // to upload. Return to the form with the note intact so retrying is one click.
      setError(err instanceof Error ? err.message : String(err));
      setPhase("details");
    }
  };

  const handleUploaded = (success: UploadSuccess) => {
    if (!mountedRef.current) return;
    setDone(success);
    setPhase("done");
  };

  return (
    // A local provider, not a global one: this flow mounts in its own React
    // root via `createPluginRoot` (see the modal), so it cannot inherit a
    // `TooltipProvider` from an ancestor the way in-tree chat components do.
    <TooltipProvider delayDuration={300}>
      <div className="tw-flex tw-flex-col tw-gap-4">
        <Stepper phase={phase} />
        {phase === "details" && (
          <DetailsStep
            sources={sources}
            note={note}
            onNoteChange={setNote}
            selected={selected}
            onToggle={(id, checked) =>
              setSelected((current) => {
                const next = new Set(current);
                if (checked) next.add(id);
                else next.delete(id);
                return next;
              })
            }
            error={error}
            onCancel={props.onCancel}
            onSubmit={() => void handleSubmit()}
          />
        )}
        {phase === "review" && (
          <ReviewStep
            report={report}
            completed={completedSteps}
            rebuildZip={props.rebuildZip}
            onRebuilt={setReport}
            revealFile={props.revealFile}
            openIssuePage={props.openIssuePage}
            upload={upload}
            onUploaded={handleUploaded}
          />
        )}
        {phase === "done" && report && done && (
          <DoneStep
            report={report}
            success={done}
            revealFile={props.revealFile}
            openIssuePage={props.openIssuePage}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

/**
 * Read-only position indicator, not navigation: clicking back would open a
 * whole re-edit state space for a bundle that has already been packed or
 * sent. Reuses `StepMarker`'s done/current/waiting visuals so this and the
 * per-attachment ticks below it share one vocabulary.
 */
function Stepper({ phase }: { phase: ReportPhase }) {
  const current = PHASE_ORDER.indexOf(phase);
  return (
    <ol className="tw-m-0 tw-flex tw-list-none tw-items-center tw-gap-2 tw-p-0 tw-text-xs">
      {PHASE_ORDER.map((p, index) => (
        <React.Fragment key={p}>
          {index > 0 && (
            <span
              className="tw-h-0 tw-flex-1 tw-border-t tw-border-solid tw-border-border"
              aria-hidden="true"
            />
          )}
          <li
            className={cn(
              "tw-flex tw-items-center tw-gap-1.5 tw-whitespace-nowrap",
              index === current ? "tw-font-medium tw-text-normal" : "tw-text-muted"
            )}
          >
            <StepMarker
              index={index + 1}
              state={index < current ? "done" : index === current ? "current" : "waiting"}
            />
            {PAGE_LABELS[p]}
          </li>
        </React.Fragment>
      ))}
    </ol>
  );
}

interface DetailsStepProps {
  sources: ReportSourceOption[];
  note: string;
  onNoteChange: (note: string) => void;
  selected: ReadonlySet<ReportSourceId>;
  onToggle: (id: ReportSourceId, checked: boolean) => void;
  error: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}

function DetailsStep({
  sources,
  note,
  onNoteChange,
  selected,
  onToggle,
  error,
  onCancel,
  onSubmit,
}: DetailsStepProps) {
  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      {error && (
        <Callout tone="error" title="Could not prepare the report">
          {error}
        </Callout>
      )}

      <div className="tw-flex tw-flex-col tw-gap-1">
        <span className="tw-text-sm tw-font-medium">What went wrong?</span>
        <Textarea
          autoFocus
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="Describe what you were doing and what happened…"
          className="tw-min-h-24"
        />
      </div>

      <div className="tw-flex tw-flex-col tw-gap-2">
        <span className="tw-text-sm tw-font-medium">Attachments — bundled into one zip</span>
        {sources.map((source) => (
          <label
            key={source.id}
            className={cn(
              "tw-flex tw-items-start tw-gap-2 tw-text-sm",
              source.disabled && "tw-opacity-60"
            )}
          >
            <Checkbox
              checked={selected.has(source.id)}
              disabled={source.disabled}
              onCheckedChange={(checked) => onToggle(source.id, checked === true)}
              className="tw-mt-0.5"
            />
            {/* Hint inline after the label, not on its own line: every hint here
                is a few words, and a second line per row is what made the list
                read as a wall of text. */}
            <span className="tw-flex tw-flex-wrap tw-items-baseline tw-gap-x-1.5">
              <span>{source.label}</span>
              {source.hint && <span className="tw-text-xs tw-text-muted">· {source.hint}</span>}
            </span>
          </label>
        ))}
      </div>

      <Callout tone="warning" title="These get uploaded to a public issue">
        Copilot packs the selected items into one zip, uploads it, and puts the link in a public
        GitHub issue — anyone who opens it can download the zip. Logs go through a best-effort scrub
        for usernames, emails, and API keys, but the screenshot is not redacted.
      </Callout>

      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="default" onClick={onSubmit}>
          Pack the report
        </Button>
      </div>
    </div>
  );
}

/**
 * Fixed-height marker column. `h-5` matches the `text-sm` line box, so a marker
 * optically centres on the row's first line whatever it holds — a nudge like
 * `mt-0.5` cannot do that, because a glyph and an icon sit differently inside
 * the same box and drift apart from each other.
 */
const MARKER_SLOT = "tw-flex tw-h-5 tw-shrink-0 tw-items-center";

/** Round badge, the shape every marker in this dialog is drawn as. */
const MARKER_BADGE =
  "tw-flex tw-size-4 tw-items-center tw-justify-center tw-rounded-full tw-text-smallest tw-font-semibold";

/**
 * Numbered marker for one step (in the prepare list or the top stepper). The
 * state is the point: a green tick for what is done, a filled accent number
 * for what is current, and a quiet outline for what comes after.
 */
function StepMarker({ index, state }: { index: number; state: "done" | "current" | "waiting" }) {
  return (
    <span className={MARKER_SLOT}>
      {state === "done" ? (
        <span
          className={cn(MARKER_BADGE, "tw-bg-success tw-text-success")}
          aria-label="done"
          role="img"
        >
          <Check className="tw-size-3" />
        </span>
      ) : (
        <span
          // The colour alone carries "this is the one waiting on you", which a
          // screen reader cannot see; `aria-current` says it in the accessibility
          // tree, and gives tests something better than a Tailwind class to
          // assert against.
          aria-current={state === "current" ? "step" : undefined}
          aria-hidden={state === "current" ? undefined : true}
          className={cn(
            MARKER_BADGE,
            state === "current"
              ? "tw-bg-interactive-accent tw-text-on-accent"
              : "tw-border tw-border-solid tw-border-border tw-text-muted"
          )}
        >
          {index}
        </span>
      )}
    </span>
  );
}

/**
 * Outcome marker for one bundled file. Shares `StepMarker`'s badge and slot, so
 * the ticks in the bundle list and the numbers in the step list land on one
 * column.
 */
function OutcomeBadge({
  tone,
  children,
}: {
  tone: "success" | "muted" | "error";
  children: React.ReactNode;
}) {
  return (
    <span className={MARKER_SLOT}>
      <span
        aria-hidden="true"
        className={cn(
          MARKER_BADGE,
          tone === "success" && "tw-bg-success tw-text-success",
          tone === "muted" && "tw-bg-secondary-alt tw-text-muted",
          tone === "error" && "tw-bg-error tw-text-error"
        )}
      >
        {children}
      </span>
    </span>
  );
}

/** One stage of `prepare`, ticked as it lands. */
function PrepareStepRow({ step, done }: { step: (typeof PREPARE_STEPS)[number]; done: boolean }) {
  return (
    <li
      data-step={step.id}
      data-state={done ? "done" : "pending"}
      className="tw-flex tw-items-start tw-gap-2"
    >
      {done ? (
        <OutcomeBadge tone="success">
          <Check className="tw-size-3" />
        </OutcomeBadge>
      ) : (
        <OutcomeBadge tone="muted">
          <CircleSlash className="tw-size-3" />
        </OutcomeBadge>
      )}
      <span className={cn(!done && "tw-text-muted")}>{step.label}</span>
    </li>
  );
}

/** The zip itself, shown alongside what it contains — a separate row because
 * `AttachmentRow` only names what is packed *inside* the zip. Rendered only
 * once the zip actually exists on disk: while a rebuild is running or has
 * just failed there is no zip to show, not merely a pending one. */
function ZipRow({ name, bytes }: { name: string; bytes: number }) {
  return (
    <li data-row="zip" className="tw-flex tw-items-start tw-gap-2">
      <OutcomeBadge tone="success">
        <FileArchive className="tw-size-3" />
      </OutcomeBadge>
      <span className="tw-flex tw-flex-wrap tw-items-baseline tw-gap-x-2">
        <span className="tw-font-medium">{name}</span>
        <span className="tw-text-xs tw-text-muted">{formatBytes(bytes)}</span>
      </span>
    </li>
  );
}

interface ReviewStepProps {
  /** Null until the bundle lands; the screen fills in rather than swapping. */
  report: PreparedReport | null;
  /** Stages `prepare` has finished, shown in place of the bundle contents. */
  completed: ReadonlySet<PrepareStep>;
  rebuildZip: (report: PreparedReport) => Promise<PreparedReport>;
  /** Replaces the flow's report with the one the rebuilt zip describes. */
  onRebuilt: (report: PreparedReport) => void;
  revealFile: (path: string) => void;
  openIssuePage: (url: string) => void;
  upload: (report: PreparedReport) => Promise<UploadOutcome>;
  /** Fired once, after a successful upload — takes the flow to the done page. */
  onUploaded: (success: UploadSuccess) => void;
}

/** `failed` and `running` both mean there is no zip on disk worth uploading. */
type RebuildState = { status: "idle" | "running" } | { status: "failed"; error: string };
/**
 * No `succeeded`: this step is unmounted the moment an upload lands, so a
 * success state here would be one nothing could ever render.
 */
type UploadState = { status: "idle" | "uploading" } | { status: "failed"; error: string };

function ReviewStep({
  report,
  completed,
  rebuildZip,
  onRebuilt,
  revealFile,
  openIssuePage,
  upload,
  onUploaded,
}: ReviewStepProps) {
  const [rebuild, setRebuild] = React.useState<RebuildState>({ status: "idle" });
  const [uploadState, setUploadState] = React.useState<UploadState>({ status: "idle" });
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // Synchronous lock shared by rebuild and upload: a click fires the handler
  // before React re-renders the button it came from as disabled, and rebuild
  // deletes the old zip before writing the new one, so the two must never run
  // at once — either would act on a file the other just pulled out from under it.
  const busyRef = React.useRef(false);

  const zipReady = rebuild.status === "idle";
  const rebuilding = rebuild.status === "running";
  const uploading = uploadState.status === "uploading";
  const opInFlight = rebuilding || uploading;
  // There is a zip on disk to hand over, and no operation is using it right now.
  const zipOnDisk = report !== null && zipReady;
  const canRebuild = report !== null && !opInFlight;
  const canUpload = zipOnDisk && !opInFlight;

  const runRebuild = async (packed: PreparedReport) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setRebuild({ status: "running" });
    try {
      const rebuilt = await rebuildZip(packed);
      if (!mountedRef.current) return;
      onRebuilt(rebuilt);
      setRebuild({ status: "idle" });
      // A fresh zip makes any earlier upload failure stale — it named a file
      // that no longer exists in that form.
      setUploadState({ status: "idle" });
    } catch (err) {
      if (!mountedRef.current) return;
      setRebuild({ status: "failed", error: err instanceof Error ? err.message : String(err) });
    } finally {
      busyRef.current = false;
    }
  };

  const runUpload = async (packed: PreparedReport) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setUploadState({ status: "uploading" });
    try {
      const outcome = await upload(packed);
      if (outcome.ok) {
        // The upload cannot be aborted, so it can land after the user dismissed
        // the dialog. The report is on the server either way — dropping the
        // link because this component is gone would leave them with an upload
        // they can neither see nor use. Opening the prefilled issue needs no
        // mounted tree, so it happens regardless.
        //
        // The page turn comes first when the flow is still up, and not for
        // style: a host that throws on the way to the browser must not leave
        // the flow stuck on "Uploading…" with the link unreachable. No success
        // state is set — `onUploaded` unmounts this step.
        if (mountedRef.current) onUploaded(outcome);
        openIssuePage(outcome.issueUrl);
      } else if (mountedRef.current) {
        setUploadState({ status: "failed", error: outcome.error });
      }
    } finally {
      busyRef.current = false;
    }
  };

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <div className="tw-flex tw-flex-col tw-gap-2">
        {/* Not "In the zip": while a rebuild is running or has failed there is no
            zip, and this list is the manifest it will be packed from. */}
        <span className="tw-text-sm tw-font-medium">Bundle contents</span>
        {/* One slot for both states: the stage ticks while packing, then what the
            bundle actually holds. Keeping the slot in place is what stops a fast
            prepare from flashing a progress view in and back out. */}
        <ul className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-gap-1 tw-p-0 tw-text-sm">
          {report
            ? [
                ...report.attachments.map((attachment) => (
                  <AttachmentRow key={attachment.id} attachment={attachment} />
                )),
                zipReady && <ZipRow key="zip" name={report.zipName} bytes={report.zipBytes} />,
              ]
            : PREPARE_STEPS.map((step) => (
                <PrepareStepRow key={step.id} step={step} done={completed.has(step.id)} />
              ))}
        </ul>
      </div>

      {rebuild.status === "failed" && (
        <Callout tone="error" title="Could not rebuild the zip">
          {rebuild.error} The old zip was removed first, so there is nothing to upload until a
          rebuild succeeds. Your files are still in the folder.
        </Callout>
      )}

      {uploadState.status === "failed" && zipReady && (
        <Callout tone="error" title="Could not upload the report">
          {uploadState.error} The zip is still on your machine. Try uploading again, or use{" "}
          <span className="tw-font-medium">Open issue anyway</span> — that issue carries no link to
          the report, so you would have to attach the zip to it yourself.
        </Callout>
      )}

      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
        <span className="tw-text-xs tw-text-muted">
          Edited the files? <span className="tw-font-medium">Rebuild zip</span> repacks them.
        </span>
        {uploading ? (
          <span className="tw-flex tw-items-center tw-gap-2 tw-text-xs tw-text-muted" role="status">
            <Loader2 className="tw-size-4 tw-animate-spin" aria-hidden="true" />
            Uploading…
          </span>
        ) : (
          <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
            <Button
              variant="secondary"
              disabled={!canRebuild}
              onClick={() => report && void runRebuild(report)}
            >
              {rebuilding ? "Rebuilding…" : "Rebuild zip"}
            </Button>
            <Button
              variant="secondary"
              disabled={report === null}
              onClick={() => report && revealFile(zipReady ? report.zipPath : report.folderPath)}
            >
              Show in folder
            </Button>
            {uploadState.status === "failed" && zipReady && (
              <Button
                variant="secondary"
                onClick={() => report && openIssuePage(report.manualIssueUrl)}
              >
                Open issue anyway
              </Button>
            )}
            <Button
              variant="default"
              disabled={!canUpload}
              onClick={() => report && void runUpload(report)}
            >
              {uploadState.status === "failed" ? "Retry upload" : "Upload & open issue"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * An expiry date the user can read, or null when there is none to show.
 *
 * Guards the parse rather than trusting the string: `expiresAt` crosses a
 * network boundary, and `new Date("whenever").toLocaleDateString()` renders the
 * words "Invalid Date" — which reads as a real answer and is worse than saying
 * nothing about how long the report is kept.
 */
function formatExpiry(expiresAt: string | undefined): string | null {
  if (!expiresAt) return null;
  const parsed = new Date(expiresAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString();
}

interface DoneStepProps {
  report: PreparedReport;
  success: UploadSuccess;
  revealFile: (path: string) => void;
  openIssuePage: (url: string) => void;
}

function DoneStep({ report, success, revealFile, openIssuePage }: DoneStepProps) {
  const { result, issueUrl } = success;
  // Absent means it was prefilled; only an explicit `false` says otherwise.
  const linkPrefilled = success.linkPrefilled !== false;
  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      {linkPrefilled ? (
        <Callout tone="success" title="Report uploaded">
          The link is already written into the issue. Nothing is filed until you press Submit in
          your browser.
        </Callout>
      ) : (
        // The upload itself succeeded — only the prefilled URL was too long to
        // carry the link. Saying "paste it" is the whole difference between a
        // report a maintainer can open and one that arrives with no bundle.
        <Callout tone="warning" title="Uploaded — paste the link into the issue">
          The report is uploaded, but the issue could not be prefilled with its link. Copy the link
          below and paste it in. Nothing is filed until you press Submit in your browser.
        </Callout>
      )}

      <div className="tw-flex tw-flex-col tw-gap-2">
        <span className="tw-text-sm tw-font-medium">What was uploaded</span>
        <ul className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-gap-1 tw-p-0 tw-text-sm">
          {report.attachments.map((attachment) => (
            <AttachmentRow key={attachment.id} attachment={attachment} />
          ))}
          <ZipRow name={report.zipName} bytes={report.zipBytes} />
        </ul>
      </div>

      <div className="tw-flex tw-flex-col tw-gap-2">
        <span className="tw-text-sm tw-font-medium">
          {linkPrefilled ? "Link in the issue" : "Link to paste"}
        </span>
        <div className="tw-flex tw-items-center tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary tw-px-3 tw-py-2">
          <code className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-xs tw-text-muted">
            {result.shareUrl}
          </code>
          <CopyButton text={result.shareUrl} />
        </div>
        {formatExpiry(result.expiresAt) && (
          <span className="tw-text-xs tw-text-muted">
            Link expires {formatExpiry(result.expiresAt)}
          </span>
        )}
      </div>

      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
        <Button variant="secondary" onClick={() => revealFile(report.zipPath)}>
          Show in folder
        </Button>
        <Button variant="default" onClick={() => openIssuePage(issueUrl)}>
          Open the issue
        </Button>
      </div>
    </div>
  );
}

function AttachmentRow({ attachment }: { attachment: AttachmentOutcome }) {
  const detail =
    attachment.status === "included"
      ? formatBytes(attachment.bytes) + (attachment.truncated ? " · truncated to newest" : "")
      : (attachment.reason ?? "");

  return (
    <li className="tw-flex tw-items-start tw-gap-2">
      {attachment.status === "included" ? (
        <OutcomeBadge tone="success">
          <Check className="tw-size-3" />
        </OutcomeBadge>
      ) : attachment.status === "skipped" ? (
        <OutcomeBadge tone="muted">
          <CircleSlash className="tw-size-3" />
        </OutcomeBadge>
      ) : (
        <OutcomeBadge tone="error">
          <X className="tw-size-3" />
        </OutcomeBadge>
      )}
      <span className="tw-flex tw-flex-wrap tw-items-baseline tw-gap-x-2">
        <span className={cn(attachment.status !== "included" && "tw-text-muted")}>
          {attachment.name}
        </span>
        {detail && <span className="tw-text-xs tw-text-muted">{detail}</span>}
      </span>
    </li>
  );
}

interface CalloutProps {
  tone: "warning" | "error" | "success";
  title: string;
  children: React.ReactNode;
}

function Callout({ tone, title, children }: CalloutProps) {
  const Icon = tone === "success" ? Check : AlertTriangle;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "tw-flex tw-items-start tw-gap-2.5 tw-rounded-md tw-border tw-border-solid tw-border-current",
        "tw-px-3.5 tw-py-2.5 tw-text-sm",
        tone === "warning" && "tw-bg-callout-warning/20 tw-text-warning",
        tone === "error" && "tw-bg-error tw-text-error",
        tone === "success" && "tw-bg-success/20 tw-text-success"
      )}
    >
      <Icon className="tw-mt-0.5 tw-size-4 tw-shrink-0" aria-hidden="true" />
      <div className="tw-flex-1">
        <span className="tw-block tw-font-semibold">{title}</span>
        <span className="tw-mt-0.5 tw-block tw-text-normal">{children}</span>
      </div>
    </div>
  );
}

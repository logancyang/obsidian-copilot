import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/utils/formatBytes";
import { type AttachmentResult, type ReportIssueDraft } from "@/utils/issueReport";
import { type ReportUploadAttempt } from "@/utils/reportUpload";
import { AlertTriangle, Check, FileArchive, Loader2, X, type LucideIcon } from "lucide-react";
import React from "react";

export type ReportSourceId = "screenshot" | "activityLog" | "chatLog" | "opencodeLog";

export interface ReportSourceOption {
  id: ReportSourceId;
  label: string;
  description?: string;
  defaultChecked: boolean;
}

type ReportPhase = "details" | "review";

export interface PreparedReport {
  zipDir: string;
  zipPath: string;
  zipName: string;
  uploadAttempt: ReportUploadAttempt;
  issueDraft: ReportIssueDraft;
  manualIssueUrl: string;
  attachments: AttachmentResult[];
}

export type UploadOutcome =
  | { ok: true; reportId: string; issueUrl: string }
  | { ok: false; error: string };

export interface ReportIssueFlowProps {
  initialNote?: string;
  sources: ReportSourceOption[];
  prepare: (note: string, selected: ReadonlySet<ReportSourceId>) => Promise<PreparedReport>;
  upload: (report: PreparedReport) => Promise<UploadOutcome>;
  discardReport: (report: PreparedReport) => Promise<void>;
  onCancel: () => void;
  onUploaded: (outcome: { reportId: string; issueUrl: string }) => void;
  openIssuePage: (url: string) => void;
  revealFile: (path: string) => void;
}

function useMountedRef() {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return mountedRef;
}

export function ReportIssueFlow(props: ReportIssueFlowProps) {
  const { sources, prepare, discardReport } = props;
  const [phase, setPhase] = React.useState<ReportPhase>("details");
  const [note, setNote] = React.useState(props.initialNote ?? "");
  const [selected, setSelected] = React.useState<Set<ReportSourceId>>(
    () => new Set(sources.filter((s) => s.defaultChecked).map((s) => s.id))
  );
  const [report, setReport] = React.useState<PreparedReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const mountedRef = useMountedRef();

  const handlePrepare = async () => {
    setError(null);
    setPhase("review");
    try {
      const result = await prepare(note, selected);
      if (!mountedRef.current) {
        // Nobody will ever upload this zip, and it is plaintext prompts and
        // note contents sitting in the OS temp folder with no UI left to name it
        // (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
        void discardReport(result);
        return;
      }
      setReport(result);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setPhase("details");
    }
  };

  const handleCancelReview = () => {
    if (report) void discardReport(report);
    props.onCancel();
  };

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      {phase === "details" ? (
        <DetailsPage
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
          onSubmit={() => void handlePrepare()}
        />
      ) : (
        <ReviewPage
          report={report}
          upload={props.upload}
          onUploaded={props.onUploaded}
          openIssuePage={props.openIssuePage}
          revealFile={props.revealFile}
          onCancel={handleCancelReview}
        />
      )}
    </div>
  );
}

interface DetailsPageProps {
  sources: ReportSourceOption[];
  note: string;
  onNoteChange: (note: string) => void;
  selected: ReadonlySet<ReportSourceId>;
  onToggle: (id: ReportSourceId, checked: boolean) => void;
  error: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}

function DetailsPage({
  sources,
  note,
  onNoteChange,
  selected,
  onToggle,
  error,
  onCancel,
  onSubmit,
}: DetailsPageProps) {
  return (
    <>
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
          <label key={source.id} className="tw-flex tw-items-start tw-gap-2 tw-text-sm">
            <Checkbox
              checked={selected.has(source.id)}
              onCheckedChange={(checked) => onToggle(source.id, checked === true)}
              className="tw-mt-0.5"
            />
            <span className="tw-flex tw-flex-col">
              <span>{source.label}</span>
              {source.description && (
                <span className="tw-text-xs tw-text-muted">{source.description}</span>
              )}
            </span>
          </label>
        ))}
      </div>

      <Callout tone="warning" title="Before you upload">
        Copilot redacts common sensitive data from diagnostic text on your device before upload.
        Review it before sending; screenshots are not automatically redacted. Reports are private
        and deleted after 60 days.
      </Callout>

      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="default" onClick={onSubmit}>
          Prepare report
        </Button>
      </div>
    </>
  );
}

interface ManifestRowProps extends React.LiHTMLAttributes<HTMLLIElement> {
  tone: "success" | "muted";
  icon: LucideIcon;
  name: string;
  size?: string;
  note?: string;
}

function ManifestRow({ tone, icon: Icon, name, size, note, ...liProps }: ManifestRowProps) {
  return (
    <li {...liProps} className="tw-flex tw-items-start tw-gap-2">
      <span className="tw-flex tw-h-5 tw-shrink-0 tw-items-center">
        <span
          aria-hidden="true"
          className={cn(
            "tw-flex tw-size-4 tw-items-center tw-justify-center tw-rounded-full",
            tone === "success"
              ? "tw-bg-success tw-text-success"
              : "tw-bg-secondary-alt tw-text-muted"
          )}
        >
          <Icon className="tw-size-3" />
        </span>
      </span>
      <span className="tw-flex tw-flex-wrap tw-items-baseline tw-gap-x-2">
        <span className={cn(tone === "muted" && "tw-text-muted")}>{name}</span>
        {size && <span className="tw-text-xs tw-text-muted">{size}</span>}
        {note && <span className="tw-text-xs tw-text-muted">{note}</span>}
      </span>
    </li>
  );
}

interface ReviewPageProps {
  report: PreparedReport | null;
  upload: (report: PreparedReport) => Promise<UploadOutcome>;
  onUploaded: (outcome: { reportId: string; issueUrl: string }) => void;
  openIssuePage: (url: string) => void;
  revealFile: (path: string) => void;
  onCancel: () => void;
}

type UploadState = "idle" | "uploading" | { failed: string };

function ReviewPage({
  report,
  upload,
  onUploaded,
  openIssuePage,
  revealFile,
  onCancel,
}: ReviewPageProps) {
  const [uploadState, setUploadState] = React.useState<UploadState>("idle");
  const mountedRef = useMountedRef();
  const uploading = uploadState === "uploading";
  const failure = typeof uploadState === "object" ? uploadState.failed : null;

  const runUpload = async (packed: PreparedReport) => {
    setUploadState("uploading");
    const outcome = await upload(packed);
    // The upload cannot be aborted, so its result can land after the user
    // dismissed the dialog. A browser tab opening then would be a surprise,
    // and there is no tree left to write a failure into
    // (https://github.com/Brevilabs/obsidian-copilot-private/issues/202).
    if (!mountedRef.current) return;
    if (outcome.ok) {
      onUploaded({ reportId: outcome.reportId, issueUrl: outcome.issueUrl });
    } else {
      setUploadState({ failed: outcome.error });
    }
  };

  return (
    <>
      <div className="tw-flex tw-flex-col tw-gap-2">
        <span className="tw-text-sm tw-font-medium">Report contents</span>
        {report ? (
          <ul className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-gap-1 tw-p-0 tw-text-sm">
            {report.attachments.map((attachment) => (
              <ManifestRow
                key={attachment.id}
                tone={attachment.included ? "success" : "muted"}
                icon={attachment.included ? Check : X}
                name={attachment.name}
                size={attachment.included ? formatBytes(attachment.bytes) : undefined}
                note={attachment.note}
              />
            ))}
            <ManifestRow
              tone="success"
              icon={FileArchive}
              name={report.zipName}
              size={formatBytes(report.uploadAttempt.body.byteLength)}
            />
          </ul>
        ) : (
          <span role="status" className="tw-text-sm tw-text-muted">
            Preparing report…
          </span>
        )}
      </div>

      {failure !== null && (
        <Callout tone="error" title="Could not upload the report">
          {failure} The zip is still on your machine; retrying sends the same report and stores it
          at most once. Or use <span className="tw-font-medium">Open issue anyway</span> — that
          issue carries no report ID, so you would have to attach the zip to it yourself.
        </Callout>
      )}

      {uploading ? (
        <span
          className="tw-flex tw-items-center tw-justify-end tw-gap-2 tw-text-xs tw-text-muted"
          role="status"
        >
          <Loader2 className="tw-size-4 tw-animate-spin" aria-hidden="true" />
          Uploading — this can&apos;t be canceled…
        </span>
      ) : (
        <div className="tw-flex tw-flex-wrap tw-justify-end tw-gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            disabled={report === null}
            onClick={() => report && revealFile(report.zipPath)}
          >
            Show zip
          </Button>
          {failure !== null && (
            <Button
              variant="secondary"
              onClick={() => report && openIssuePage(report.manualIssueUrl)}
            >
              Open issue anyway
            </Button>
          )}
          <Button
            variant="default"
            disabled={report === null}
            onClick={() => report && void runUpload(report)}
          >
            {failure !== null ? "Retry upload" : "Upload & open issue"}
          </Button>
        </div>
      )}
    </>
  );
}

function Callout({
  tone,
  title,
  children,
}: {
  tone: "warning" | "error";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "tw-flex tw-items-start tw-gap-2.5 tw-rounded-md tw-border tw-border-solid tw-border-current",
        "tw-px-3.5 tw-py-2.5 tw-text-sm",
        tone === "warning"
          ? "tw-bg-callout-warning/20 tw-text-warning"
          : "tw-bg-error tw-text-error"
      )}
    >
      <AlertTriangle className="tw-mt-0.5 tw-size-4 tw-shrink-0" aria-hidden="true" />
      <div className="tw-flex-1">
        <span className="tw-block tw-font-semibold">{title}</span>
        <span className="tw-mt-0.5 tw-block tw-text-normal">{children}</span>
      </div>
    </div>
  );
}

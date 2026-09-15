import {
  ReportIssueFlow,
  type PreparedReport,
  type ReportIssueFlowProps,
  type ReportSourceOption,
  type UploadOutcome,
} from "@/agentMode/ui/ReportIssueFlow";
import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";

/**
 * The sources as `ReportIssueModal.buildSources()` offers them on a fresh
 * install with opencode active: the activity log carries a description only
 * once it has been turned off, and the chat log is pre-selected only with
 * Debug Mode on.
 */
const SOURCES: ReportSourceOption[] = [
  { id: "screenshot", label: "Screenshot of the Agent Mode pane", defaultChecked: true },
  { id: "activityLog", label: "Agent Mode activity log", defaultChecked: true },
  {
    id: "chatLog",
    label: "Regular chat log",
    description: "copilot log file",
    defaultChecked: false,
  },
  {
    id: "opencodeLog",
    label: "OpenCode backend log",
    description: "may include unrelated sessions",
    defaultChecked: false,
  },
];

/** A packed report whose manifest covers an included, a truncated, and an excluded source. */
const REPORT: PreparedReport = {
  zipDir: "/tmp/copilot-report-a1b2c3",
  zipPath: "/tmp/copilot-report-a1b2c3/copilot-report-a1b2c3.zip",
  zipName: "copilot-report-a1b2c3.zip",
  uploadAttempt: {
    body: new ArrayBuffer(4_404_019),
    idempotencyKey: "3f2a1d9e-8b4c-4f6d-9e2a-7c5b3a1d9e8f",
  },
  issueDraft: { title: "Agent stops mid-turn", body: "It stops after the first tool call." },
  manualIssueUrl: "https://github.com/logancyang/obsidian-copilot/issues/new",
  attachments: [
    { id: "report", name: "report.md", bytes: 2_310, included: true },
    { id: "screenshot", name: "screenshot.png", bytes: 284_115, included: true },
    {
      id: "activityLog",
      name: "acp-frames.ndjson.txt",
      bytes: 2_097_152,
      included: true,
      note: "truncated to the newest entries of 40 MB",
    },
    {
      id: "chatLog",
      name: "copilot-chat-log.md",
      bytes: 0,
      included: false,
      note: "failed: EACCES",
    },
  ],
};

const UPLOADED: UploadOutcome = {
  ok: true,
  reportId: "9f3c1a7b2e4d5f60819a2b3c4d5e6f70",
  issueUrl: "https://github.com/logancyang/obsidian-copilot/issues/new?body=...",
};

/** Never settles — parks the flow on whichever state the story wants to show. */
const pending = <T,>(): Promise<T> => new Promise<T>(() => undefined);

const BASE: ReportIssueFlowProps = {
  sources: SOURCES,
  prepare: async () => REPORT,
  upload: async () => UPLOADED,
  discardReport: async () => undefined,
  onCancel: () => undefined,
  onUploaded: () => undefined,
  openIssuePage: () => undefined,
  revealFile: () => undefined,
};

/**
 * Drives the flow to a later state the way a user does, since the page is
 * internal state rather than a prop. Clicks the named buttons in order, polling
 * because each one only becomes clickable once the previous step resolves.
 */
const AtStep: React.FC<{ steps: string[]; props?: Partial<ReportIssueFlowProps> }> = ({
  steps,
  props,
}) => {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    let index = 0;
    const tick = window.setInterval(() => {
      if (index >= steps.length) return window.clearInterval(tick);
      const button = Array.from(ref.current?.querySelectorAll("button") ?? []).find(
        (candidate) => candidate.textContent?.trim() === steps[index] && !candidate.disabled
      );
      if (!button) return;
      button.click();
      index += 1;
    }, 50);
    return () => window.clearInterval(tick);
  }, [steps]);
  return (
    <div ref={ref}>
      <ReportIssueFlow {...BASE} {...props} />
    </div>
  );
};

const PREPARE = "Prepare report";
const UPLOAD = "Upload & open issue";

const meta = {
  title: "Agent Mode/Report Issue Flow",
  component: ReportIssueFlow,
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<ReportIssueFlowProps>;
export default meta;

/** Details page: what to include, plus the disclosure of what leaves the device. */
export const Details: StoryObj<ReportIssueFlowProps> = {
  render: () => <ReportIssueFlow {...BASE} />,
};

/**
 * Review page mid-prepare. There is no separate progress screen — the page is
 * up from the first frame with the stage ticks standing in for the manifest.
 */
export const Preparing: StoryObj<ReportIssueFlowProps> = {
  render: () => <AtStep steps={[PREPARE]} props={{ prepare: () => pending<PreparedReport>() }} />,
};

/** Review page: one line per source, included or not, plus the zip itself. */
export const Review: StoryObj<ReportIssueFlowProps> = {
  render: () => <AtStep steps={[PREPARE]} />,
};

/** Review page with the upload in flight — the actions are gone, not merely disabled. */
export const Uploading: StoryObj<ReportIssueFlowProps> = {
  render: () => (
    <AtStep steps={[PREPARE, UPLOAD]} props={{ upload: () => pending<UploadOutcome>() }} />
  ),
};

/**
 * Review page after a failed upload. Every failure gets the same three ways
 * out: retry the same attempt, reveal the zip, or file the issue by hand.
 */
export const UploadFailed: StoryObj<ReportIssueFlowProps> = {
  render: () => (
    <AtStep
      steps={[PREPARE, UPLOAD]}
      props={{
        upload: async () => ({ ok: false, error: "Upload failed (HTTP 502)." }),
      }}
    />
  ),
};

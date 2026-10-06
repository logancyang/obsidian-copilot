import {
  ReportIssueFlow,
  type PreparedReport,
  type ReportIssueFlowProps,
  type ReportSourceOption,
  type UploadOutcome,
} from "@/agentMode/ui/ReportIssueFlow";
import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";

const SOURCES: ReportSourceOption[] = [
  { id: "screenshot", label: "Screenshot of the Agent Mode pane", defaultChecked: true },
  { id: "activityLog", label: "Agent Mode activity log", defaultChecked: true },
  {
    id: "chatLog",
    label: "Copilot log",
    description: "includes Agent Mode backend errors",
    defaultChecked: true,
  },
  {
    id: "opencodeLog",
    label: "OpenCode backend log",
    description: "may include unrelated sessions",
    defaultChecked: false,
  },
];

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
      name: "copilot-log.md",
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

export const Details: StoryObj<ReportIssueFlowProps> = {
  render: () => <ReportIssueFlow {...BASE} />,
};

export const Preparing: StoryObj<ReportIssueFlowProps> = {
  render: () => <AtStep steps={[PREPARE]} props={{ prepare: () => pending<PreparedReport>() }} />,
};

export const Review: StoryObj<ReportIssueFlowProps> = {
  render: () => <AtStep steps={[PREPARE]} />,
};

export const Uploading: StoryObj<ReportIssueFlowProps> = {
  render: () => (
    <AtStep steps={[PREPARE, UPLOAD]} props={{ upload: () => pending<UploadOutcome>() }} />
  ),
};

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

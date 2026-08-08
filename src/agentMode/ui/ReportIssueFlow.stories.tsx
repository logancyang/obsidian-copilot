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
  { id: "activityLog", label: "Agent Mode activity log", hint: "412 KB", defaultChecked: true },
  { id: "chatLog", label: "Chat log", hint: "1.2 MB", defaultChecked: true },
  {
    id: "opencodeLog",
    label: "OpenCode log",
    hint: "Turn on Keep an OpenCode log to include this",
    defaultChecked: false,
    disabled: true,
  },
];

/** A packed bundle whose per-item outcomes cover every status the review page renders. */
const REPORT: PreparedReport = {
  folderPath: "/tmp/copilot-report-a1b2c3/bundle",
  rootDir: "/tmp/copilot-report-a1b2c3",
  zipPath: "/tmp/copilot-report-a1b2c3/copilot-report-a1b2c3.zip",
  zipName: "copilot-report-a1b2c3.zip",
  zipBytes: 4_404_019,
  issueDraft: { title: "Agent stops mid-turn", body: "It stops after the first tool call." },
  manualIssueUrl: "https://github.com/logancyang/obsidian-copilot/issues/new",
  attachments: [
    {
      id: "screenshot",
      name: "screenshot.png",
      absPath: "/tmp/copilot-report-a1b2c3/bundle/screenshot.png",
      bytes: 284_115,
      status: "included",
    },
    {
      id: "activityLog",
      name: "agent-activity.ndjson",
      absPath: "/tmp/copilot-report-a1b2c3/bundle/agent-activity.ndjson",
      bytes: 4_119_904,
      status: "included",
      truncated: true,
      reason: "Kept the newest 4 MB",
    },
    {
      id: "chatLog",
      name: "chat.md",
      absPath: null,
      bytes: 0,
      status: "failed",
      reason: "Could not read the chat log",
    },
    {
      id: "opencodeLog",
      name: "opencode.log",
      absPath: null,
      bytes: 0,
      status: "skipped",
      reason: "Not selected",
    },
  ],
};

const UPLOADED: UploadOutcome = {
  ok: true,
  result: {
    shareUrl: "https://reports.example.invalid/r/a1b2c3",
    expiresAt: "2026-09-06T00:00:00.000Z",
  },
  issueUrl: "https://github.com/logancyang/obsidian-copilot/issues/new?body=...",
};

/** Never settles — parks the flow on whichever step the story wants to show. */
const pending = <T,>(): Promise<T> => new Promise<T>(() => undefined);

const BASE: ReportIssueFlowProps = {
  sources: SOURCES,
  prepare: async () => REPORT,
  rebuildZip: async (report) => report,
  discardReport: () => undefined,
  upload: async () => UPLOADED,
  onCancel: () => undefined,
  revealFile: () => undefined,
  openIssuePage: () => undefined,
};

/**
 * Drives the flow to a later page the way a user does, since the phase is
 * internal state rather than a prop. Clicks the named buttons in order, polling
 * because each one only appears once the previous step resolves.
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

const PACK = "Pack the report";
const UPLOAD = "Upload & open issue";

const meta = {
  title: "Agent Mode/Report Issue Flow",
  component: ReportIssueFlow,
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<ReportIssueFlowProps>;
export default meta;

/** Page ①: what to include, plus the disclosure of where the bundle ends up. */
export const Details: StoryObj<ReportIssueFlowProps> = {
  render: () => <ReportIssueFlow {...BASE} />,
};

/**
 * Page ② mid-pack. There is no separate progress screen — the review page is up
 * from the first frame with the manifest empty and the zip row still pending,
 * which is the state a slow pack actually leaves on screen.
 */
export const Packing: StoryObj<ReportIssueFlowProps> = {
  render: () => <AtStep steps={[PACK]} props={{ prepare: () => pending<PreparedReport>() }} />,
};

/** Page ②: the zip plus a per-item list covering included, truncated, failed, skipped. */
export const Review: StoryObj<ReportIssueFlowProps> = {
  render: () => <AtStep steps={[PACK]} />,
};

/** Page ② with the upload in flight — both actions are locked while it runs. */
export const Uploading: StoryObj<ReportIssueFlowProps> = {
  render: () => (
    <AtStep steps={[PACK, UPLOAD]} props={{ upload: () => pending<UploadOutcome>() }} />
  ),
};

/** Page ② after a failed upload: the zip is still on disk, so retry and manual both stay. */
export const UploadFailed: StoryObj<ReportIssueFlowProps> = {
  render: () => (
    <AtStep
      steps={[PACK, UPLOAD]}
      props={{ upload: async () => ({ ok: false, error: "Network error" }) }}
    />
  ),
};

/** Page ③: the link is already in the issue, and nothing is filed until Submit. */
export const Done: StoryObj<ReportIssueFlowProps> = {
  render: () => <AtStep steps={[PACK, UPLOAD]} />,
};

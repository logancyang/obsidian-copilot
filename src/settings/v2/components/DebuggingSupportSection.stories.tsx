import type { Meta, StoryObj } from "@/lib/story";
import {
  DebuggingSupportSection,
  type DebuggingSupportSectionProps,
} from "./DebuggingSupportSection";

const FRAME_LOG_PATH = "/var/folders/t2/obsidian-copilot/acp-frames/3f9a1c/acp-frames.ndjson";

const meta = {
  title: "Settings/Debugging & Support Section",
  component: DebuggingSupportSection,
  args: {
    debug: false,
    frameLogEnabled: true,
    frameLogPath: FRAME_LOG_PATH,
    onDebugChange: () => {},
    onFrameLogChange: () => {},
    onReportIssue: () => {},
    onOpenFrameLog: () => {},
    onClearFrameLog: () => {},
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<DebuggingSupportSectionProps>;
export default meta;

export const FreshInstall: StoryObj<DebuggingSupportSectionProps> = {};

export const ActivityLogOff: StoryObj<DebuggingSupportSectionProps> = {
  args: { frameLogEnabled: false },
};

export const BothLogsOn: StoryObj<DebuggingSupportSectionProps> = {
  args: { debug: true, frameLogEnabled: true },
};

export const DesktopOnlyPath: StoryObj<DebuggingSupportSectionProps> = {
  args: { frameLogPath: "(Agent Mode frame logs are desktop-only)" },
};

export const LongFrameLogPath: StoryObj<DebuggingSupportSectionProps> = {
  args: {
    debug: true,
    frameLogEnabled: true,
    frameLogPath: `${FRAME_LOG_PATH.replace(".ndjson", "")}-with-an-unusually-long-vault-name.ndjson`,
  },
};

import type { Meta, StoryObj } from "@/lib/story";
import {
  DebuggingSupportSection,
  type DebuggingSupportSectionProps,
} from "./DebuggingSupportSection";

const FRAME_LOG_PATH = "/var/folders/t2/obsidian-copilot/acp-frames/3f9a1c/acp-frames.ndjson";

const meta = {
  title: "Settings/Agent Mode Debugging Section",
  component: DebuggingSupportSection,
  args: {
    frameLogEnabled: false,
    frameLogPath: FRAME_LOG_PATH,
    onFrameLogChange: () => {},
    onReportIssue: () => {},
    onOpenFrameLog: () => {},
    onClearFrameLog: () => {},
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<DebuggingSupportSectionProps>;
export default meta;

/** Logging turned off, with reporting still offered. */
export const Default: StoryObj<DebuggingSupportSectionProps> = {};

/** Recording, which is the state a user is asked to reproduce a bug in. */
export const LogEnabled: StoryObj<DebuggingSupportSectionProps> = {
  args: { frameLogEnabled: true },
};

/**
 * Mobile, where there is no frame log to open. The path is a sentence rather
 * than a path, so the description has to read as prose either way.
 */
export const DesktopOnlyPath: StoryObj<DebuggingSupportSectionProps> = {
  args: { frameLogPath: "(Agent Mode frame logs are desktop-only)" },
};

/**
 * The longest path this section can be handed. It sits inside a description
 * that has to keep wrapping as prose — narrow the canvas with the gallery's
 * width toolbar to see where it stops doing so.
 */
export const LongFrameLogPath: StoryObj<DebuggingSupportSectionProps> = {
  args: {
    frameLogEnabled: true,
    frameLogPath: `${FRAME_LOG_PATH.replace(".ndjson", "")}-with-an-unusually-long-vault-name.ndjson`,
  },
};

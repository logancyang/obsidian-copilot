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
    frameLogEnabled: false,
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

/** How the section looks on a fresh install: both logs off, reporting still offered. */
export const Default: StoryObj<DebuggingSupportSectionProps> = {};

/** Debug Mode on — the chat log will arrive pre-selected in the report dialog. */
export const DebugModeOn: StoryObj<DebuggingSupportSectionProps> = {
  args: { debug: true },
};

/** Both logs recording, which is the state a user is asked to reproduce a bug in. */
export const BothLogsOn: StoryObj<DebuggingSupportSectionProps> = {
  args: { debug: true, frameLogEnabled: true },
};

/**
 * Mobile, where there is no frame log to open. The path is a sentence rather
 * than a path, so the description has to read as prose either way.
 */
export const DesktopOnlyPath: StoryObj<DebuggingSupportSectionProps> = {
  args: { frameLogPath: "(Agent Mode frame logs are desktop-only)" },
};

/**
 * The longest path this section can be handed. The switch and its two buttons
 * share a row with it, so a path that does not wrap is what pushes them out of
 * the pane first — narrow the canvas with the gallery's width toolbar to see it.
 */
export const LongFrameLogPath: StoryObj<DebuggingSupportSectionProps> = {
  args: {
    debug: true,
    frameLogEnabled: true,
    frameLogPath: `${FRAME_LOG_PATH.replace(".ndjson", "")}-with-an-unusually-long-vault-name.ndjson`,
  },
};

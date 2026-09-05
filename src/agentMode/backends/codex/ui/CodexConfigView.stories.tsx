import {
  CodexConfigView,
  type CodexConfigViewProps,
} from "@/agentMode/backends/codex/ui/CodexConfigView";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Codex Config View",
  component: CodexConfigView,
  args: {
    state: { kind: "absent" },
    installRun: { kind: "idle" },
    onInstall: () => undefined,
    binaryPath: "",
    onSavePath: () => Promise.resolve(null),
    onClearPath: () => undefined,
    detect: () => Promise.resolve(null),
    searchedDirs: () => [],
    onClose: () => undefined,
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<CodexConfigViewProps>;
export default meta;

/** First run: no adapter configured, so the path field is empty. */
export const NotSetUp: StoryObj<CodexConfigViewProps> = {};

/** A custom adapter remains usable and can be switched to Copilot management. */
export const Ready: StoryObj<CodexConfigViewProps> = {
  args: { state: { kind: "ready", source: "custom" }, binaryPath: "/usr/local/bin/codex-acp" },
};

/** The pinned managed adapter can be reinstalled without a global npm package. */
export const ManagedReady: StoryObj<CodexConfigViewProps> = {
  args: { state: { kind: "ready", source: "managed" } },
};

/** Shared operation progress shown while Copilot installs its pinned adapter. */
export const ManagedInstalling: StoryObj<CodexConfigViewProps> = {
  args: { installRun: { kind: "running", label: "Installing the Codex adapter…", percent: 30 } },
};

/** Failed installs retain the error and make the same operation retryable. */
export const ManagedRetry: StoryObj<CodexConfigViewProps> = {
  args: {
    installRun: { kind: "error", message: "npm was not found. Install Node.js, then retry." },
  },
};

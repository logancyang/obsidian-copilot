import {
  CodexConfigView,
  type CodexConfigViewProps,
} from "@/agentMode/backends/codex/ui/CodexConfigView";
import type { InstallState } from "@/agentMode/session/types";
import type { Meta, StoryObj } from "@/lib/story";

const OUTDATED: InstallState = {
  kind: "incompatible",
  source: "custom",
  currentVersion: "0.4.1",
  minVersion: "0.5.0",
  message: "codex-acp 0.4.1 is not supported. Copilot requires 0.5.0 or newer.",
};

const meta = {
  title: "Agent Mode/Codex Config View",
  component: CodexConfigView,
  args: {
    state: { kind: "absent" },
    binaryPath: "",
    onSavePath: () => Promise.resolve(null),
    onClearPath: () => undefined,
    detect: () => Promise.resolve(null),
    searchedDirs: () => [],
    onClose: () => undefined,
  },
  // The real dialog fills its modal edge to edge, so the story asks for a width
  // the modal clamps to its own — anything narrower hides the full-bleed bands.
  parameters: { gallery: { host: "modal", layout: "padded", width: 600 } },
} satisfies Meta<CodexConfigViewProps>;
export default meta;

/** First run: no adapter configured, so the path field is empty. */
export const NotSetUp: StoryObj<CodexConfigViewProps> = {};

/** Codex has no auth capability, so step 2 is the command alone. */
export const Ready: StoryObj<CodexConfigViewProps> = {
  args: { state: { kind: "ready", source: "custom" }, binaryPath: "/usr/local/bin/codex-acp" },
};

export const UpdateRequired: StoryObj<CodexConfigViewProps> = {
  args: { state: OUTDATED, binaryPath: "/usr/local/bin/codex-acp" },
};

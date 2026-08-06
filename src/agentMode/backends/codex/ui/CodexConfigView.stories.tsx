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

/** Codex has no auth capability, so step 2 is the command alone. */
export const Ready: StoryObj<CodexConfigViewProps> = {
  args: { state: { kind: "ready", source: "custom" }, binaryPath: "/usr/local/bin/codex-acp" },
};

import {
  AntigravityConfigView,
  type AntigravityConfigViewProps,
} from "@/agentMode/backends/antigravity/ui/AntigravityConfigView";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Antigravity Config View",
  component: AntigravityConfigView,
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
} satisfies Meta<AntigravityConfigViewProps>;
export default meta;

/** First run: no adapter configured, so the path field is empty. */
export const NotSetUp: StoryObj<AntigravityConfigViewProps> = {};

/** Antigravity has no in-app OAuth dialog, so step 2 is the command alone. */
export const Ready: StoryObj<AntigravityConfigViewProps> = {
  args: {
    state: { kind: "ready", source: "custom" },
    binaryPath: "/usr/local/bin/antigravity-acp",
  },
};

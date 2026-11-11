import { FULL_BLEED_MODAL_CLASS } from "@/components/modals/ReactModal";
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
    hasBinaryPathOverride: false,
    onSavePath: () => Promise.resolve(null),
    onClearPath: () => undefined,
    detect: () => Promise.resolve(null),
    searchedDirs: () => ["~/.local/bin", "/opt/homebrew/bin", "/usr/local/bin"],
    signInCommand: null,
    onClose: () => undefined,
  },
  parameters: {
    gallery: { host: "modal", layout: "fullscreen", modalClass: FULL_BLEED_MODAL_CLASS },
  },
} satisfies Meta<AntigravityConfigViewProps>;
export default meta;

export const NotSetUp: StoryObj<AntigravityConfigViewProps> = {};

export const Ready: StoryObj<AntigravityConfigViewProps> = {
  args: {
    state: { kind: "ready", source: "custom" },
    binaryPath: "/Users/zero/.local/bin/agy",
    signInCommand: "/Users/zero/.local/bin/agy acp --login",
  },
};

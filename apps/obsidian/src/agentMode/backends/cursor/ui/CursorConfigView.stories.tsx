import { FULL_BLEED_MODAL_CLASS } from "@/components/modals/ReactModal";
import type { InstallState } from "@/agentMode/session/types";
import type { Meta, StoryObj } from "@/lib/story";
import { CursorConfigView, type CursorConfigViewProps } from "./CursorConfigView";

const signedOut = {
  terminalCommand: "agent login",
  onSignOut: () => undefined,
  signingOut: false,
  status: { signedIn: false },
  onSignIn: () => undefined,
  signingIn: false,
  url: null,
};

const meta = {
  title: "Agent Mode/Cursor Config View",
  component: CursorConfigView,
  args: {
    state: { kind: "absent" } satisfies InstallState,
    binaryPath: "",
    hasBinaryPathOverride: false,
    onSavePath: () => Promise.resolve(null),
    onClearPath: () => undefined,
    detect: () => Promise.resolve(null),
    searchedDirs: () => [],
    auth: signedOut,
    onClose: () => undefined,
  },
  parameters: {
    gallery: { host: "modal", layout: "fullscreen", modalClass: FULL_BLEED_MODAL_CLASS },
  },
} satisfies Meta<CursorConfigViewProps>;
export default meta;

export const NotSetUp: StoryObj<CursorConfigViewProps> = {};

export const Ready: StoryObj<CursorConfigViewProps> = {
  args: {
    state: { kind: "ready", source: "custom" },
    binaryPath: "/Users/zero/.local/bin/agent",
    auth: {
      ...signedOut,
      status: { signedIn: true, label: "zero@example.com" },
    },
  },
};

export const SigningIn: StoryObj<CursorConfigViewProps> = {
  args: {
    state: { kind: "ready", source: "custom" },
    binaryPath: "/Users/zero/.local/bin/agent",
    hasBinaryPathOverride: true,
    auth: {
      ...signedOut,
      signingIn: true,
      url: "https://cursor.com/loginDeepControl?challenge=example",
    },
  },
};

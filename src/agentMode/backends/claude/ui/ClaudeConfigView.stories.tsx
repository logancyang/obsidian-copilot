import {
  ClaudeConfigView,
  type ClaudeConfigViewProps,
} from "@/agentMode/backends/claude/ui/ClaudeConfigView";
import type { InstallState } from "@/agentMode/session/types";
import type { Meta, StoryObj } from "@/lib/story";

const OUTDATED: InstallState = {
  kind: "incompatible",
  source: "custom",
  currentVersion: "2.1.205",
  minVersion: "2.1.206",
  message: "Claude 2.1.205 is not supported. Copilot requires 2.1.206 or newer.",
};

const meta = {
  title: "Agent Mode/Claude Config View",
  component: ClaudeConfigView,
  args: {
    state: { kind: "absent" },
    binaryPath: "",
    hasBinaryPathOverride: false,
    onSavePath: () => Promise.resolve(null),
    onClearPath: () => undefined,
    detect: () => Promise.resolve(null),
    searchedDirs: () => [],
    auth: {
      status: { signedIn: false },
      onSignIn: () => undefined,
      signingIn: false,
      url: null,
    },
    onClose: () => undefined,
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<ClaudeConfigViewProps>;
export default meta;

/** First run: no CLI found, so the path field is empty and the steps below explain why. */
export const NotSetUp: StoryObj<ClaudeConfigViewProps> = {};

export const Ready: StoryObj<ClaudeConfigViewProps> = {
  args: {
    state: { kind: "ready", source: "managed" },
    binaryPath: "/Users/zero/.local/bin/claude",
    auth: {
      status: { signedIn: true, label: "zero@example.com" },
      onSignIn: () => undefined,
      signingIn: false,
      url: null,
    },
  },
};

/** A custom-path install must be updated in place or cleared so auto-detection can take over. */
export const UpdateRequired: StoryObj<ClaudeConfigViewProps> = {
  args: {
    state: OUTDATED,
    binaryPath: "/Users/zero/.local/bin/claude",
    hasBinaryPathOverride: true,
  },
};

/** Sign-in in flight: the in-app button is busy, the command stays copyable. */
export const SigningIn: StoryObj<ClaudeConfigViewProps> = {
  args: {
    state: { kind: "ready", source: "custom" },
    binaryPath: "/Users/zero/.local/bin/claude",
    hasBinaryPathOverride: true,
    auth: {
      status: { signedIn: false },
      onSignIn: () => undefined,
      signingIn: true,
      url: null,
    },
  },
};

/** The CLI printed a URL because it could not open the OAuth page itself. */
export const OAuthFallback: StoryObj<ClaudeConfigViewProps> = {
  args: {
    state: { kind: "ready", source: "custom" },
    binaryPath: "/Users/zero/.local/bin/claude",
    hasBinaryPathOverride: true,
    auth: {
      status: { signedIn: false },
      onSignIn: () => undefined,
      signingIn: true,
      url: "https://claude.ai/oauth/authorize?code=example",
    },
  },
};

/** A long path must not push Auto-detect and Apply out of the band. */
export const LongPath: StoryObj<ClaudeConfigViewProps> = {
  args: {
    state: { kind: "ready", source: "custom" },
    binaryPath:
      "/Users/zero/Library/Application Support/fnm/node-versions/v22.11.0/installation/bin/claude",
    hasBinaryPathOverride: true,
  },
};

import {
  CONFIG_MODAL_CLASS,
  ConfigDialogShell,
  ConfigSection,
  ConfigWarningStrip,
} from "@/agentMode/backends/shared/ui/ConfigDialogShell";
import type { InstallState } from "@/agentMode/session/types";
import { Button } from "@/components/ui/button";
import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";

type ConfigDialogShellProps = React.ComponentProps<typeof ConfigDialogShell>;

const OUTDATED: InstallState = {
  kind: "incompatible",
  source: "managed",
  currentVersion: "0.14.2",
  minVersion: "0.15.6",
  message: "opencode v0.14.2 is not supported. Copilot requires opencode v0.15.6 or newer.",
};

const CLAUDE_OUTDATED: InstallState = {
  kind: "incompatible",
  source: "custom",
  currentVersion: "2.1.205",
  minVersion: "2.1.206",
  message: "Claude 2.1.205 is not supported. Copilot requires 2.1.206 or newer.",
};

const CODEX_ERROR: InstallState = {
  kind: "error",
  message: "Could not read /usr/local/bin/codex-acp.",
};

const UPDATE_HINT = "Update it with the install command below, then reopen this dialog.";

// Deliberately generic: each agent's Configure dialog composes its own body, so
// borrowing one agent's controls here would read as that agent's approved design.
const BODY = (
  <>
    <ConfigSection title="First section">
      <p className="tw-my-0 tw-text-sm tw-text-muted">
        Placeholder body. Agents fill their sections with their own controls; the shell only
        guarantees the band's padding and the hairline above it.
      </p>
    </ConfigSection>
    <ConfigSection title="Second section">
      <p className="tw-my-0 tw-text-sm tw-text-muted">
        A second band shows the divider between neighbours, which should reach both edges of the
        modal rather than stopping short of them.
      </p>
    </ConfigSection>
  </>
);

const meta = {
  title: "Agent Mode/Config Dialog Shell",
  component: ConfigDialogShell,
  args: {
    title: "Configure opencode",
    state: { kind: "absent" },
    children: BODY,
    onClose: () => undefined,
  },
  parameters: { gallery: { host: "modal", layout: "padded", modalClass: CONFIG_MODAL_CLASS } },
} satisfies Meta<ConfigDialogShellProps>;
export default meta;

export const NotSetUp: StoryObj<ConfigDialogShellProps> = {};

export const Ready: StoryObj<ConfigDialogShellProps> = {
  args: { state: { kind: "ready", source: "managed" } },
};

export const UpdateRequiredWithUpgrade: StoryObj<ConfigDialogShellProps> = {
  args: {
    state: OUTDATED,
    warning: (
      <ConfigWarningStrip
        state={OUTDATED}
        action={
          <div className="tw-flex tw-justify-end">
            <Button size="sm">Upgrade to latest</Button>
          </div>
        }
      />
    ),
  },
};

export const UpdateRequiredCommandOnly: StoryObj<ConfigDialogShellProps> = {
  args: {
    title: "Configure Claude",
    state: CLAUDE_OUTDATED,
    warning: <ConfigWarningStrip state={CLAUDE_OUTDATED} detail={UPDATE_HINT} />,
  },
};

export const ErrorState: StoryObj<ConfigDialogShellProps> = {
  args: {
    title: "Configure Codex",
    state: CODEX_ERROR,
    warning: <ConfigWarningStrip state={CODEX_ERROR} />,
  },
};

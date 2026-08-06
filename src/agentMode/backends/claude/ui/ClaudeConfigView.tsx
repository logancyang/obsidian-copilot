import { CLAUDE_AUTH_COMMAND, CLAUDE_INSTALL_COMMAND } from "@/agentMode/backends/claude/cliSetup";
import { claudeUpdateDetail } from "@/agentMode/backends/claude/claudeUpdateDetail";
import { BinaryPathSetting } from "@/agentMode/backends/shared/BinaryPathSetting";
import {
  ConfigDialogShell,
  ConfigSection,
  ConfigWarningStrip,
} from "@/agentMode/backends/shared/ui/ConfigDialogShell";
import { CommandBlock, SetupStep } from "@/agentMode/backends/shared/ui/SetupSteps";
import type { InstallState } from "@/agentMode/session/types";
import { Button } from "@/components/ui/button";
import React from "react";

/** In-app equivalent of the sign-in command, for backends that can run it themselves. */
export interface ClaudeAuthProps {
  /** Start the CLI's interactive sign-in. */
  onSignIn: () => void;
  /** True while a sign-in is running, so the button can't be fired twice. */
  signingIn: boolean;
  /** Browser fallback printed by the CLI when it cannot open OAuth itself. */
  url: string | null;
}

export interface ClaudeConfigViewProps {
  /** Readiness of the resolved CLI; drives the header badge and the warning strip. */
  state: InstallState;
  /** Persisted path override; empty when the CLI is auto-detected. */
  binaryPath: string;
  /** Validate and persist a user-supplied path. Resolves to an error message, or null on success. */
  onSavePath: (path: string) => Promise<string | null>;
  /** Forget the override and fall back to auto-detection. */
  onClearPath: () => void;
  /** Look for a `claude` CLI already present on this machine. */
  detect: () => Promise<string | null>;
  /** Directories `detect` looked in, listed when it finds nothing. */
  searchedDirs: () => string[];
  /** Omitted when Copilot cannot drive the CLI's sign-in itself. */
  auth?: ClaudeAuthProps;
  onClose: () => void;
}

const PATH_PLACEHOLDER =
  process.platform === "win32" ? "/absolute/path/to/claude.exe" : "/absolute/path/to/claude";

/**
 * Configure dialog body for the Claude backend. Leads with the one field that
 * makes the agent work — where the `claude` CLI is — and demotes installing and
 * signing in to a numbered block for the users who still need them. There is no
 * managed install: an unsupported auto-detected version is fixed by re-running
 * the install command, while a custom-path install must be updated in place or
 * cleared. Neither case offers an in-dialog upgrade.
 *
 * Pure props, so the gallery and unit tests can drive every state;
 * `ClaudeInstallModal` supplies the settings reads, validation, and notices.
 */
export const ClaudeConfigView: React.FC<ClaudeConfigViewProps> = ({
  state,
  binaryPath,
  onSavePath,
  onClearPath,
  detect,
  searchedDirs,
  auth,
  onClose,
}) => (
  <ConfigDialogShell
    title="Configure Claude"
    state={state}
    warning={<ConfigWarningStrip state={state} detail={claudeUpdateDetail(state)} />}
    onClose={onClose}
  >
    <ConfigSection title="Claude Code binary">
      <p className="tw-my-0 tw-text-sm tw-text-muted">
        Copilot runs the <code>claude</code> CLI on this machine. Auto-detect checks the usual
        install locations.
      </p>
      <BinaryPathSetting
        binaryName="claude"
        placeholder={PATH_PLACEHOLDER}
        initialPath={binaryPath}
        notFoundHint="claude not found in known install locations. Run the install command below, then click Auto-detect again."
        onSave={onSavePath}
        onClear={onClearPath}
        persistOnAutoDetect
        detect={detect}
        searchedDirs={searchedDirs}
      />
    </ConfigSection>

    <ConfigSection title="Don't have it yet?">
      {/* The section's own gap sets the rhythm inside a step, so the steps need a
          wider one to read as two items rather than one run of controls. */}
      <div className="tw-flex tw-flex-col tw-gap-4">
        <SetupStep index={1} title="Install it">
          <CommandBlock command={CLAUDE_INSTALL_COMMAND} />
        </SetupStep>
        <SetupStep index={2} title="Sign in">
          <CommandBlock
            command={CLAUDE_AUTH_COMMAND}
            action={
              auth &&
              (auth.signingIn && auth.url ? (
                <Button asChild variant="secondary" size="sm">
                  <a href={auth.url} target="_blank" rel="noopener noreferrer">
                    Open sign-in page
                  </a>
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={auth.onSignIn}
                  disabled={auth.signingIn}
                >
                  {auth.signingIn ? "Signing in…" : "Sign in"}
                </Button>
              ))
            }
          />
          <p className="tw-my-0 tw-text-sm tw-text-muted">
            Copilot inherits whatever credentials the Claude Code CLI holds — there is no key to
            paste here.
          </p>
        </SetupStep>
      </div>
    </ConfigSection>
  </ConfigDialogShell>
);

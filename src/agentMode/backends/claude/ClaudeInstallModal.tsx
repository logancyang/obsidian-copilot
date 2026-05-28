import { BinaryPathSetting } from "@/agentMode/backends/shared/BinaryPathSetting";
import { ConfigDialogShell, ConfigSection } from "@/agentMode/backends/shared/ConfigDialogShell";
import { InstallCommandRow } from "@/agentMode/backends/shared/InstallCommandRow";
import { InstallStatusLine } from "@/agentMode/backends/shared/installStatus";
import type { InstallState } from "@/agentMode/session/types";
import { ReactModal } from "@/components/modals/ReactModal";
import { Button } from "@/components/ui/button";
import { setSettings, useSettingsValue } from "@/settings/model";
import { validateExecutableFile } from "@/utils/detectBinary";
import { App, Notice } from "obsidian";
import React from "react";
import { CLAUDE_INSTALL_COMMAND, detectClaudeCliPath, resolveClaudeCliPath } from "./descriptor";

/**
 * Configure dialog for the Claude (Agent SDK) backend. The SDK auto-detects the
 * `claude` CLI; this dialog surfaces the resolved path, the install command, an
 * optional custom path override, and auth guidance. There is no managed
 * install — the user installs the `claude` CLI themselves.
 */
const ClaudeConfigBody: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const settings = useSettingsValue();

  const overridePath = settings.agentMode?.claudeCli?.path ?? "";
  const resolvedPath = resolveClaudeCliPath(settings);
  const isCustom = Boolean(overridePath);

  const sessionState: InstallState = resolvedPath
    ? { kind: "ready", source: isCustom ? "custom" : "managed" }
    : { kind: "absent" };

  const onSaveCustomPath = React.useCallback(async (path: string): Promise<string | null> => {
    const err = await validateExecutableFile(path);
    if (err) return err;
    setSettings((cur) => ({ agentMode: { ...cur.agentMode, claudeCli: { path } } }));
    new Notice("Claude CLI path saved.");
    return null;
  }, []);

  const clearCustomPath = React.useCallback((): void => {
    setSettings((cur) => ({ agentMode: { ...cur.agentMode, claudeCli: undefined } }));
    new Notice("Claude CLI override cleared. Auto-detection will be used.");
  }, []);

  return (
    <ConfigDialogShell status={<InstallStatusLine state={sessionState} />} onClose={onClose}>
      <ConfigSection title="Install Claude Code">
        <InstallCommandRow command={CLAUDE_INSTALL_COMMAND} />
      </ConfigSection>

      <ConfigSection title="Use a custom claude path">
        <p className="tw-my-0 tw-text-sm tw-text-muted">
          Use an existing <code>claude</code> binary you have on disk.
        </p>
        <BinaryPathSetting
          binaryName="claude"
          placeholder="/absolute/path/to/claude"
          initialPath={overridePath}
          notFoundHint={`claude not found on disk. Install with \`${CLAUDE_INSTALL_COMMAND}\` and try again, or paste a custom path manually.`}
          onSave={onSaveCustomPath}
          persistOnAutoDetect
          detect={() => Promise.resolve(detectClaudeCliPath())}
        />
        {isCustom && (
          <div className="tw-flex tw-justify-end">
            <Button variant="destructive" size="default" onClick={clearCustomPath}>
              Clear path
            </Button>
          </div>
        )}
      </ConfigSection>

      <ConfigSection title="Authentication">
        <p className="tw-my-0 tw-text-sm tw-text-muted">
          Credentials inherit from the <code>claude</code> CLI login state — run <code>claude</code>{" "}
          once to sign in — or set <code>ANTHROPIC_API_KEY</code> (or Bedrock / Vertex env) in your
          shell.
        </p>
      </ConfigSection>
    </ConfigDialogShell>
  );
};

/** Configure dialog for the Claude backend. Opened via `descriptor.openInstallUI`. */
export class ClaudeInstallModal extends ReactModal {
  constructor(app: App) {
    super(app, "Configure Claude");
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <ClaudeConfigBody onClose={close} />;
  }
}

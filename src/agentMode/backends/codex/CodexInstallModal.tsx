import { ReactModal } from "@/components/modals/ReactModal";
import { BinaryPathSetting } from "@/components/agent/BinaryPathSetting";
import { Button } from "@/components/ui/button";
import { logError } from "@/logger";
import { validateExecutableFile } from "@/utils/detectBinary";
import { getSettings } from "@/settings/model";
import { App, Notice } from "obsidian";
import React from "react";
import { CODEX_BINARY_NAME, CODEX_INSTALL_COMMAND, updateCodexFields } from "./descriptor";

interface ContentProps {
  onClose: () => void;
}

const CodexInstallContent: React.FC<ContentProps> = ({ onClose }) => {
  const initial = getSettings().agentMode?.backends?.codex?.binaryPath ?? "";

  const onSave = React.useCallback(
    async (path: string): Promise<string | null> => {
      const err = await validateExecutableFile(path);
      if (err) return err;
      updateCodexFields({ binaryPath: path });
      new Notice("Codex binary path saved.");
      onClose();
      return null;
    },
    [onClose]
  );

  const copy = React.useCallback((): void => {
    navigator.clipboard.writeText(CODEX_INSTALL_COMMAND).catch((e) => {
      logError("[AgentMode] copy install command failed", e);
    });
    new Notice("Copied to clipboard.");
  }, []);

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <p>
        Codex uses the official <code>@zed-industries/codex-acp</code> adapter, which wraps the
        local <code>codex</code> CLI. It inherits your existing <code>codex login</code> credentials
        — or set <code>OPENAI_API_KEY</code> / <code>CODEX_API_KEY</code> in your shell if you
        prefer API-key auth.
      </p>
      <div className="tw-flex tw-flex-col tw-gap-1">
        <span className="tw-text-xs tw-text-muted">Install command</span>
        <div className="tw-flex tw-items-center tw-gap-2">
          <code className="tw-flex-1 tw-break-all tw-rounded tw-bg-secondary tw-p-2 tw-text-xs">
            {CODEX_INSTALL_COMMAND}
          </code>
          <Button variant="ghost" size="sm" onClick={copy}>
            Copy
          </Button>
        </div>
      </div>
      <div className="tw-flex tw-flex-col tw-gap-2">
        <span className="tw-text-xs tw-text-muted">Binary path</span>
        <BinaryPathSetting
          binaryName={CODEX_BINARY_NAME}
          placeholder="/absolute/path/to/codex-acp"
          initialPath={initial}
          notFoundHint={`${CODEX_BINARY_NAME} not found on PATH. Run the install command above, then click Auto-detect again.`}
          onSave={onSave}
        />
      </div>
      <div className="tw-flex tw-justify-end">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

export class CodexInstallModal extends ReactModal {
  constructor(app: App) {
    super(app, "Configure Codex (Agent backend)");
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <CodexInstallContent onClose={close} />;
  }
}

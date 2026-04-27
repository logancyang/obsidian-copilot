import { ReactModal } from "@/components/modals/ReactModal";
import { BinaryPathSetting } from "@/components/agent/BinaryPathSetting";
import { Button } from "@/components/ui/button";
import { logError } from "@/logger";
import { validateExecutableFile } from "@/utils/detectBinary";
import { getSettings } from "@/settings/model";
import { App, Notice } from "obsidian";
import React from "react";
import {
  CLAUDE_CODE_BINARY_NAME,
  CLAUDE_CODE_INSTALL_COMMAND,
  updateClaudeCodeFields,
} from "./descriptor";

interface ContentProps {
  onClose: () => void;
}

const ClaudeCodeInstallContent: React.FC<ContentProps> = ({ onClose }) => {
  const initial = getSettings().agentMode?.backends?.["claude-code"]?.binaryPath ?? "";

  const onSave = React.useCallback(
    async (path: string): Promise<string | null> => {
      const err = await validateExecutableFile(path);
      if (err) return err;
      updateClaudeCodeFields({ binaryPath: path });
      new Notice("Claude Code binary path saved.");
      onClose();
      return null;
    },
    [onClose]
  );

  const copy = React.useCallback((): void => {
    navigator.clipboard.writeText(CLAUDE_CODE_INSTALL_COMMAND).catch((e) => {
      logError("[AgentMode] copy install command failed", e);
    });
    new Notice("Copied to clipboard.");
  }, []);

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <p>
        Claude Code uses the official <code>@agentclientprotocol/claude-agent-acp</code> adapter,
        which wraps the local <code>claude</code> CLI. It inherits your existing{" "}
        <code>claude auth login</code> credentials — no API key needed if you&apos;re already signed
        in.
      </p>
      <div className="tw-flex tw-flex-col tw-gap-1">
        <span className="tw-text-xs tw-text-muted">Install command</span>
        <div className="tw-flex tw-items-center tw-gap-2">
          <code className="tw-flex-1 tw-break-all tw-rounded tw-bg-secondary tw-p-2 tw-text-xs">
            {CLAUDE_CODE_INSTALL_COMMAND}
          </code>
          <Button variant="ghost" size="sm" onClick={copy}>
            Copy
          </Button>
        </div>
      </div>
      <div className="tw-flex tw-flex-col tw-gap-2">
        <span className="tw-text-xs tw-text-muted">Binary path</span>
        <BinaryPathSetting
          binaryName={CLAUDE_CODE_BINARY_NAME}
          placeholder="/absolute/path/to/claude-agent-acp"
          initialPath={initial}
          notFoundHint={`${CLAUDE_CODE_BINARY_NAME} not found on PATH. Run the install command above, then click Auto-detect again.`}
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

export class ClaudeCodeInstallModal extends ReactModal {
  constructor(app: App) {
    super(app, "Configure Claude Code (Agent backend)");
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <ClaudeCodeInstallContent onClose={close} />;
  }
}

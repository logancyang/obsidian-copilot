import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { logError } from "@/logger";
import { detectBinary, validateExecutableFile } from "@/utils/detectBinary";
import { getSettings } from "@/settings/model";
import { App, Modal, Notice } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";
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
  const [path, setPath] = React.useState(initial);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const autoDetect = React.useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const found = await detectBinary(CLAUDE_CODE_BINARY_NAME);
      if (!found) {
        setError(
          `${CLAUDE_CODE_BINARY_NAME} not found on PATH. Run the install command above, then click Auto-detect again.`
        );
        return;
      }
      setPath(found);
      new Notice(`Found ${CLAUDE_CODE_BINARY_NAME} at ${found}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const save = React.useCallback(async (): Promise<void> => {
    const trimmed = path.trim();
    if (!trimmed) {
      setError("Path is required.");
      return;
    }
    const validationError = await validateExecutableFile(trimmed);
    if (validationError) {
      setError(validationError);
      return;
    }
    updateClaudeCodeFields({ binaryPath: trimmed });
    new Notice("Claude Code binary path saved.");
    onClose();
  }, [path, onClose]);

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
        <div className="tw-flex tw-items-center tw-gap-2">
          <Input
            type="text"
            placeholder="/absolute/path/to/claude-agent-acp"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
          <Button variant="secondary" size="sm" onClick={autoDetect} disabled={busy}>
            Auto-detect
          </Button>
        </div>
        {error && <div className="tw-text-xs tw-text-error">{error}</div>}
      </div>
      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="default" onClick={save} disabled={busy}>
          Save
        </Button>
      </div>
    </div>
  );
};

export class ClaudeCodeInstallModal extends Modal {
  private root: Root | null = null;

  constructor(app: App) {
    super(app);
    // @ts-expect-error - setTitle is part of Obsidian's Modal but missing from older type defs
    this.setTitle("Configure Claude Code (Agent backend)");
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.root = createRoot(contentEl);
    this.root.render(<ClaudeCodeInstallContent onClose={() => this.close()} />);
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}

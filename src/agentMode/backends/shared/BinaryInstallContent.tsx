import { ReactModal } from "@/components/modals/ReactModal";
import { BinaryPathSetting } from "@/components/agent/BinaryPathSetting";
import { Button } from "@/components/ui/button";
import { logError } from "@/logger";
import { validateExecutableFile } from "@/utils/detectBinary";
import { App, Notice } from "obsidian";
import React from "react";

export interface BinaryInstallContentProps {
  /** Modal title (e.g. "Configure Claude Code (Agent backend)"). */
  modalTitle: string;
  /** Lower-case display label for save toast (e.g. "Claude Code"). */
  binaryDisplayName: string;
  /** Binary lookup name (e.g. "claude-agent-acp"). */
  binaryName: string;
  /** Shell command to install the binary. */
  installCommand: string;
  /** Placeholder shown in the binary-path input. */
  pathPlaceholder: string;
  /** Initial path read from settings. */
  initialPath: string;
  /** Body paragraph above the install command. */
  description: React.ReactNode;
  /** Persist the validated path back to settings. */
  onPersist: (path: string) => void;
  onClose: () => void;
}

const BinaryInstallContent: React.FC<BinaryInstallContentProps> = ({
  binaryDisplayName,
  binaryName,
  installCommand,
  pathPlaceholder,
  initialPath,
  description,
  onPersist,
  onClose,
}) => {
  const onSave = React.useCallback(
    async (path: string): Promise<string | null> => {
      const err = await validateExecutableFile(path);
      if (err) return err;
      onPersist(path);
      new Notice(`${binaryDisplayName} binary path saved.`);
      onClose();
      return null;
    },
    [binaryDisplayName, onPersist, onClose]
  );

  const copy = React.useCallback((): void => {
    navigator.clipboard.writeText(installCommand).catch((e) => {
      logError("[AgentMode] copy install command failed", e);
    });
    new Notice("Copied to clipboard.");
  }, [installCommand]);

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <p>{description}</p>
      <div className="tw-flex tw-flex-col tw-gap-1">
        <span className="tw-text-xs tw-text-muted">Install command</span>
        <div className="tw-flex tw-items-center tw-gap-2">
          <code className="tw-flex-1 tw-break-all tw-rounded tw-bg-secondary tw-p-2 tw-text-xs">
            {installCommand}
          </code>
          <Button variant="ghost" size="sm" onClick={copy}>
            Copy
          </Button>
        </div>
      </div>
      <div className="tw-flex tw-flex-col tw-gap-2">
        <span className="tw-text-xs tw-text-muted">Binary path</span>
        <BinaryPathSetting
          binaryName={binaryName}
          placeholder={pathPlaceholder}
          initialPath={initialPath}
          notFoundHint={`${binaryName} not found on PATH. Run the install command above, then click Auto-detect again.`}
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

/**
 * Generic install modal for backends whose configuration is "point us at a
 * binary." Backends provide identifying strings + a persist callback.
 */
export class BinaryInstallModal extends ReactModal {
  constructor(
    app: App,
    private readonly props: Omit<BinaryInstallContentProps, "onClose">
  ) {
    super(app, props.modalTitle);
  }

  protected renderContent(close: () => void): React.ReactElement {
    return <BinaryInstallContent {...this.props} onClose={close} />;
  }
}

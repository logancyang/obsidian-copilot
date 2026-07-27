import { Button } from "@/components/ui/button";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import type { SymposiumAction, SymposiumReceipt } from "@/symposium/types";
import { App, Modal } from "obsidian";
import React, { useState } from "react";
import type { Root } from "react-dom/client";

export interface SymposiumSuccessResult {
  kind: "success";
  action: SymposiumAction;
  receipt?: SymposiumReceipt;
}

export interface SymposiumFailureResult {
  kind: "failure";
  action: SymposiumAction;
  message: string;
  accessNotice: boolean;
  retryable: boolean;
}

export interface SymposiumPersistenceResult {
  kind: "persistence";
  action: SymposiumAction;
  message: string;
  receipt?: SymposiumReceipt;
  retrySave?: () => Promise<SymposiumModalResult>;
}

export type SymposiumModalResult =
  | SymposiumSuccessResult
  | SymposiumFailureResult
  | SymposiumPersistenceResult;

export interface SymposiumModalOptions {
  fileName: string;
  docId: string | null;
  initialResult?: SymposiumModalResult;
  onConfirm: (action: SymposiumAction, ownerDocument: Document) => Promise<SymposiumModalResult>;
  onClosed?: () => void;
}

interface SymposiumModalContentProps extends SymposiumModalOptions {
  onClose: () => void;
}

function actionLabel(action: SymposiumAction): string {
  return `${action[0].toUpperCase()}${action.slice(1)}`;
}

interface SymposiumReceiptViewProps {
  receipt: SymposiumReceipt;
  actions?: React.ReactNode;
}

function SymposiumReceiptView({ receipt, actions }: SymposiumReceiptViewProps) {
  const [copyMessage, setCopyMessage] = useState("");

  const copyUrl = async (event: React.MouseEvent<HTMLButtonElement>) => {
    try {
      await event.currentTarget.win.navigator.clipboard.writeText(receipt.url);
      setCopyMessage("Copied");
    } catch {
      setCopyMessage("Could not copy the link");
    }
  };

  const openUrl = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.win.open(receipt.url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="tw-flex tw-flex-col tw-gap-3">
      <code className="tw-break-all tw-rounded-md tw-bg-secondary tw-p-2 tw-text-small">
        {receipt.url}
      </code>
      <div className="tw-text-small tw-text-muted">
        Document {receipt.docId} · Version {receipt.version}
      </div>
      <div className="tw-flex tw-items-center tw-justify-end tw-gap-2">
        {copyMessage && <span className="tw-text-small tw-text-muted">{copyMessage}</span>}
        {actions}
        <Button variant="secondary" onClick={copyUrl}>
          Copy
        </Button>
        <Button onClick={openUrl}>Open</Button>
      </div>
    </div>
  );
}

function SymposiumModalContent({
  fileName,
  docId,
  initialResult,
  onConfirm,
  onClose,
}: SymposiumModalContentProps) {
  const [result, setResult] = useState<SymposiumModalResult | null>(initialResult ?? null);
  const [workingAction, setWorkingAction] = useState<SymposiumAction | null>(null);
  const working = workingAction !== null;

  const runAction = async (nextAction: SymposiumAction, ownerDocument: Document) => {
    setWorkingAction(nextAction);
    try {
      setResult(await onConfirm(nextAction, ownerDocument));
    } finally {
      setWorkingAction(null);
    }
  };

  const retry = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (result?.kind === "failure") {
      void runAction(result.action, event.currentTarget.doc);
    }
  };

  const retrySave = async () => {
    if (result?.kind !== "persistence" || !result.retrySave) {
      return;
    }
    setWorkingAction(result.action);
    try {
      setResult(await result.retrySave());
    } finally {
      setWorkingAction(null);
    }
  };

  if (result?.kind === "success") {
    const closeButton = (
      <Button variant="secondary" onClick={onClose}>
        Close
      </Button>
    );
    return (
      <div className="tw-flex tw-flex-col tw-gap-4">
        <div className="tw-font-semibold tw-text-normal">
          {result.action === "delete"
            ? "Removed from Symposium"
            : `${actionLabel(result.action)} complete`}
        </div>
        {result.receipt ? (
          <SymposiumReceiptView receipt={result.receipt} actions={closeButton} />
        ) : (
          <div className="tw-flex tw-justify-end">{closeButton}</div>
        )}
      </div>
    );
  }

  if (result?.kind === "failure") {
    return (
      <div className="tw-flex tw-flex-col tw-gap-4" role="alert">
        <div className="tw-font-semibold tw-text-normal">
          {result.accessNotice
            ? "Symposium access required"
            : `${actionLabel(result.action)} failed`}
        </div>
        <p className="tw-m-0 tw-text-muted">{result.message}</p>
        <div className="tw-flex tw-justify-end tw-gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {result.retryable && (
            <Button onClick={retry} disabled={working}>
              {working ? "Retrying…" : "Retry"}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (result?.kind === "persistence") {
    const actions = (
      <>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        {result.retrySave && (
          <Button onClick={() => void retrySave()} disabled={working}>
            {working ? "Saving…" : "Retry save"}
          </Button>
        )}
      </>
    );
    return (
      <div className="tw-flex tw-flex-col tw-gap-4" role="alert">
        <div className="tw-font-semibold tw-text-normal">
          {result.action === "publish"
            ? "Published, but not saved to the note"
            : result.action === "update"
              ? "Page updated; note identity not verified"
              : "Page withdrawn; note unchanged"}
        </div>
        <p className="tw-m-0 tw-text-muted">{result.message}</p>
        {result.receipt ? (
          <SymposiumReceiptView receipt={result.receipt} actions={actions} />
        ) : (
          <div className="tw-flex tw-justify-end tw-gap-2">{actions}</div>
        )}
      </div>
    );
  }

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <div>
        <div className="tw-font-semibold tw-text-normal">
          {docId ? `Manage “${fileName}”` : `Publish “${fileName}”?`}
        </div>
        <p className="tw-mb-0 tw-mt-2 tw-text-muted">
          {docId
            ? "Update replaces the current public page. Delete withdraws the link and removes Symposium’s stored copy; previously fetched or cached copies cannot be recalled."
            : "This makes the note available to anyone with the public link."}
        </p>
      </div>

      <div className="tw-flex tw-justify-end tw-gap-2" aria-label="Symposium actions">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {docId ? (
          <>
            <Button
              onClick={(event) => void runAction("update", event.currentTarget.doc)}
              disabled={working}
            >
              {workingAction === "update" ? "Updating…" : "Update"}
            </Button>
            <Button
              variant="destructive"
              onClick={(event) => void runAction("delete", event.currentTarget.doc)}
              disabled={working}
            >
              {workingAction === "delete" ? "Deleting…" : "Delete"}
            </Button>
          </>
        ) : (
          <Button
            onClick={(event) => void runAction("publish", event.currentTarget.doc)}
            disabled={working}
          >
            {workingAction === "publish" ? "Publishing…" : "Publish"}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Hosts the complete state-aware Symposium confirmation and result flow for one note.
 */
export class SymposiumModal extends Modal {
  private root: Root | null = null;

  constructor(
    app: App,
    private readonly options: SymposiumModalOptions
  ) {
    super(app);
    this.titleEl.setText("Share with Symposium");
  }

  onOpen(): void {
    this.contentEl.empty();
    this.root = createPluginRoot(this.contentEl, this.app);
    this.root.render(<SymposiumModalContent {...this.options} onClose={() => this.close()} />);
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
    this.options.onClosed?.();
  }
}

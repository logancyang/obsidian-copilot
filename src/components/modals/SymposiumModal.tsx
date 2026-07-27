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
  action: "publish" | "delete";
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
  onConfirm: (action: SymposiumAction, ownerDocument: Document) => Promise<SymposiumModalResult>;
  onClosed?: () => void;
}

interface SymposiumModalContentProps extends SymposiumModalOptions {
  onClose: () => void;
  onWorkingChange: (working: boolean) => void;
}

function actionLabel(action: SymposiumAction): string {
  return `${action[0].toUpperCase()}${action.slice(1)}`;
}

function SymposiumReceiptView({ receipt }: { receipt: SymposiumReceipt }) {
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
  onConfirm,
  onClose,
  onWorkingChange,
}: SymposiumModalContentProps) {
  const [action, setAction] = useState<SymposiumAction>(docId ? "update" : "publish");
  const [result, setResult] = useState<SymposiumModalResult | null>(null);
  const [working, setWorking] = useState(false);

  const runAction = async (nextAction: SymposiumAction, ownerDocument: Document) => {
    setWorking(true);
    onWorkingChange(true);
    try {
      setResult(await onConfirm(nextAction, ownerDocument));
    } finally {
      setWorking(false);
      onWorkingChange(false);
    }
  };

  const confirm = (event: React.MouseEvent<HTMLButtonElement>) => {
    void runAction(action, event.currentTarget.doc);
  };

  const retry = (event: React.MouseEvent<HTMLButtonElement>) => {
    void runAction(result?.action ?? action, event.currentTarget.doc);
  };

  const retrySave = async () => {
    if (result?.kind !== "persistence" || !result.retrySave) {
      return;
    }
    setWorking(true);
    onWorkingChange(true);
    try {
      setResult(await result.retrySave());
    } finally {
      setWorking(false);
      onWorkingChange(false);
    }
  };

  if (result?.kind === "success") {
    return (
      <div className="tw-flex tw-flex-col tw-gap-4">
        <div className="tw-font-semibold tw-text-normal">
          {result.action === "delete"
            ? "Removed from Symposium"
            : `${actionLabel(result.action)} complete`}
        </div>
        {result.receipt && <SymposiumReceiptView receipt={result.receipt} />}
        <div className="tw-flex tw-justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
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
    return (
      <div className="tw-flex tw-flex-col tw-gap-4" role="alert">
        <div className="tw-font-semibold tw-text-normal">
          {result.action === "publish"
            ? "Published, but not saved to the note"
            : "Page withdrawn; note unchanged"}
        </div>
        <p className="tw-m-0 tw-text-muted">{result.message}</p>
        {result.receipt && <SymposiumReceiptView receipt={result.receipt} />}
        <div className="tw-flex tw-justify-end tw-gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {result.retrySave && (
            <Button onClick={() => void retrySave()} disabled={working}>
              {working ? "Saving…" : "Retry save"}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <div>
        <div className="tw-font-semibold tw-text-normal">
          {actionLabel(action)} “{fileName}”?
        </div>
        <p className="tw-mb-0 tw-mt-2 tw-text-muted">
          {action === "delete"
            ? "Yes withdraws the link and deletes Symposium’s stored copy. Previously fetched or cached copies cannot be recalled."
            : "Yes makes this note available to anyone with the public link."}
        </p>
      </div>

      {docId && (
        <div className="tw-flex tw-gap-2" aria-label="Symposium action">
          <Button
            variant={action === "update" ? "default" : "secondary"}
            onClick={() => setAction("update")}
            disabled={working}
          >
            Update
          </Button>
          <Button
            variant={action === "delete" ? "destructive" : "secondary"}
            onClick={() => setAction("delete")}
            disabled={working}
          >
            Delete
          </Button>
        </div>
      )}

      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button variant="secondary" onClick={onClose} disabled={working}>
          No, cancel
        </Button>
        <Button
          variant={action === "delete" ? "destructive" : "default"}
          onClick={confirm}
          disabled={working}
        >
          {working ? "Working…" : `Yes, ${action}`}
        </Button>
      </div>
    </div>
  );
}

/**
 * Hosts the complete state-aware Symposium confirmation and result flow for one note.
 */
export class SymposiumModal extends Modal {
  private root: Root | null = null;
  private working = false;
  private forceClose = false;

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
    this.root.render(
      <SymposiumModalContent
        {...this.options}
        onClose={() => this.close()}
        onWorkingChange={(working) => {
          this.working = working;
        }}
      />
    );
  }

  close(): void {
    if (!this.working || this.forceClose) {
      super.close();
    }
  }

  /**
   * Closes the modal during plugin teardown even if a confirmed request is still settling.
   */
  dispose(): void {
    this.forceClose = true;
    this.close();
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
    this.options.onClosed?.();
  }
}

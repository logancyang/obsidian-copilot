import { Button } from "@/components/ui/button";
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import type { SymposiumAction, SymposiumDocument, SymposiumReceipt } from "@/symposium/types";
import { App, Modal } from "obsidian";
import React, { useState } from "react";
import type { Root } from "react-dom/client";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

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

/** Immutable host-owned data shown before an agent-authored document can be sent. */
export interface SymposiumDocumentReview {
  readonly sourcePath: string;
  readonly digest: string;
  readonly payload: SymposiumDocument;
  readonly previewPath: string;
  readonly previewUrl: string;
}

export interface SymposiumModalOptions {
  fileName: string;
  docId: string | null;
  review?: SymposiumDocumentReview;
  initialResult?: SymposiumModalResult;
  onConfirm: (action: SymposiumAction, ownerDocument: Document) => Promise<SymposiumModalResult>;
  onRegenerate?: () => void;
  onClosed?: () => void;
}

interface SymposiumModalContentProps extends SymposiumModalOptions {
  onClose: () => void;
}

function actionLabel(action: SymposiumAction): string {
  return `${action[0].toUpperCase()}${action.slice(1)}`;
}

const WORKING_LABELS: Record<SymposiumAction, string> = {
  publish: "Publishing…",
  update: "Updating…",
  delete: "Deleting…",
};

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
        <a
          href={receipt.url}
          target="_blank"
          rel="noopener noreferrer"
          className="tw-text-accent tw-underline"
        >
          {receipt.url}
        </a>
      </code>
      <div className="tw-text-small tw-text-muted">
        Document {receipt.docId} · Version {receipt.version}
      </div>
      <div className="tw-flex tw-items-center tw-justify-end tw-gap-2">
        {copyMessage && <span className="tw-text-small tw-text-muted">{copyMessage}</span>}
        {actions}
        <Button variant="secondary" onClick={safeAsyncHandler(copyUrl)}>
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
  review,
  initialResult,
  onConfirm,
  onRegenerate,
  onClose,
}: SymposiumModalContentProps) {
  const [confirmationAction, setConfirmationAction] = useState<SymposiumAction | null>(
    review ? (docId ? "update" : "publish") : docId ? null : "publish"
  );
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
          {result.retryable && !review && (
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

  const heading = confirmationAction
    ? review
      ? `Review “${review.payload.title}”`
      : `${actionLabel(confirmationAction)} “${fileName}”?`
    : `Manage “${fileName}”`;
  const description = review
    ? `These exact HTML bytes will ${confirmationAction === "update" ? "replace the current public page" : "become public"} only after you confirm.`
    : confirmationAction === "delete"
      ? "Yes withdraws the link and deletes Symposium’s stored copy. Previously fetched or cached copies cannot be recalled."
      : confirmationAction === "update"
        ? "Yes replaces the current public page with this note’s latest content."
        : confirmationAction === "publish"
          ? "Yes makes this note available to anyone with the public link."
          : "Choose whether to replace the current public page or withdraw it.";

  return (
    <div className="tw-flex tw-flex-col tw-gap-4">
      <div>
        <div className="tw-font-semibold tw-text-normal">{heading}</div>
        <p className="tw-mb-0 tw-mt-2 tw-text-muted">{description}</p>
      </div>

      {review && (
        <div className="tw-flex tw-flex-col tw-gap-2">
          <div className="tw-grid tw-grid-cols-[auto,1fr] tw-gap-x-3 tw-gap-y-1 tw-text-small">
            <span className="tw-text-muted">Source</span>
            <code className="tw-break-all">{review.sourcePath}</code>
            <span className="tw-text-muted">Title</span>
            <span>{review.payload.title}</span>
            <span className="tw-text-muted">HTML</span>
            <span>{review.payload.byteLength} bytes</span>
            <span className="tw-text-muted">SHA-256</span>
            <code className="tw-break-all">{review.digest}</code>
          </div>
          <p className="tw-m-0 tw-text-small tw-text-muted">
            Open a sandboxed local preview of these exact HTML bytes in your default browser, review
            it, then return here to confirm.
          </p>
          <a
            href={review.previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={review.previewPath}
            className="tw-text-accent tw-underline"
            onClick={(event) => {
              event.preventDefault();
              void openWithSystemDefault(review.previewPath);
            }}
          >
            Open local HTML preview
          </a>
        </div>
      )}

      <div className="tw-flex tw-flex-wrap tw-justify-end tw-gap-2" aria-label="Symposium actions">
        {confirmationAction ? (
          <>
            {review && onRegenerate && (
              <Button
                variant="secondary"
                onClick={() => {
                  onRegenerate();
                  onClose();
                }}
                disabled={working}
              >
                Ask agent to regenerate
              </Button>
            )}
            <Button variant="secondary" onClick={onClose} disabled={working}>
              No, cancel
            </Button>
            <Button
              variant={confirmationAction === "delete" ? "destructive" : "default"}
              onClick={(event) => void runAction(confirmationAction, event.currentTarget.doc)}
              disabled={working}
            >
              {working ? WORKING_LABELS[confirmationAction] : `Yes, ${confirmationAction}`}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => setConfirmationAction("update")}>Update</Button>
            <Button variant="destructive" onClick={() => setConfirmationAction("delete")}>
              Delete
            </Button>
          </>
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
    this.modalEl.classList.add("copilot-symposium-modal");
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

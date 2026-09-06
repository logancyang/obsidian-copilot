import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import type {
  OpenArtifactsAction,
  OpenArtifactsDocument,
  OpenArtifactsReceipt,
} from "@/openArtifacts/types";
import { App, Modal } from "obsidian";
import React, { useCallback, useEffect, useState } from "react";
import type { Root } from "react-dom/client";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

export interface OpenArtifactsSuccessResult {
  kind: "success";
  action: OpenArtifactsAction;
  receipt?: OpenArtifactsReceipt;
}

export interface OpenArtifactsFailureResult {
  kind: "failure";
  action: OpenArtifactsAction;
  message: string;
  accessNotice: boolean;
  retryable: boolean;
}

export interface OpenArtifactsPersistenceResult {
  kind: "persistence";
  action: OpenArtifactsAction;
  message: string;
  receipt?: OpenArtifactsReceipt;
  retrySave?: () => Promise<OpenArtifactsModalResult>;
}

export type OpenArtifactsModalResult =
  | OpenArtifactsSuccessResult
  | OpenArtifactsFailureResult
  | OpenArtifactsPersistenceResult;

/** Immutable host-owned data shown before an agent-authored document can be sent. */
export interface OpenArtifactsDocumentReview {
  readonly sourcePath: string;
  readonly digest: string;
  readonly payload: OpenArtifactsDocument;
  readonly previewPath: string;
  readonly previewUrl: string;
}

export interface OpenArtifactsModalOptions {
  fileName: string;
  docId: string | null;
  review?: OpenArtifactsDocumentReview;
  initialResult?: OpenArtifactsModalResult;
  onConfirm: (
    action: OpenArtifactsAction,
    ownerDocument: Document
  ) => Promise<OpenArtifactsModalResult>;
  onRegenerate?: () => void;
  onClosed?: () => void;
}

export interface OpenArtifactsModalContentProps extends OpenArtifactsModalOptions {
  onClose: () => void;
  openPreview?: (path: string) => Promise<boolean>;
}

function actionLabel(action: OpenArtifactsAction): string {
  return `${action[0].toUpperCase()}${action.slice(1)}`;
}

const WORKING_LABELS: Record<OpenArtifactsAction, string> = {
  publish: "Publishing…",
  update: "Updating…",
  delete: "Deleting…",
};

interface OpenArtifactsReceiptViewProps {
  receipt: OpenArtifactsReceipt;
  actions?: React.ReactNode;
}

function OpenArtifactsReceiptView({ receipt, actions }: OpenArtifactsReceiptViewProps) {
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

export function OpenArtifactsModalContent({
  fileName,
  docId,
  review,
  initialResult,
  onConfirm,
  onRegenerate,
  onClose,
  openPreview = openWithSystemDefault,
}: OpenArtifactsModalContentProps) {
  const [confirmationAction, setConfirmationAction] = useState<OpenArtifactsAction | null>(
    review ? (docId ? "update" : "publish") : docId ? null : "publish"
  );
  const [result, setResult] = useState<OpenArtifactsModalResult | null>(initialResult ?? null);
  const [workingAction, setWorkingAction] = useState<OpenArtifactsAction | null>(null);
  const working = workingAction !== null;
  const [previewOpened, setPreviewOpened] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [manuallyReviewed, setManuallyReviewed] = useState(false);
  const canConfirmReview = previewOpened || manuallyReviewed;
  const presentPreview = useCallback(async () => {
    if (!review) return;
    setPreviewOpened(false);
    setManuallyReviewed(false);
    // Browser dispatch is required before human approval; a link alone is insufficient.
    // https://github.com/logancyang/obsidian-copilot/issues/3121
    const opened = await openPreview(review.previewPath).catch(() => false);
    setPreviewOpened(opened);
    setPreviewFailed(!opened);
  }, [review, openPreview]);

  useEffect(() => {
    void presentPreview();
  }, [presentPreview]);

  const runAction = async (nextAction: OpenArtifactsAction, ownerDocument: Document) => {
    if (review && !canConfirmReview) return;
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
            ? "Removed from OpenArtifacts"
            : `${actionLabel(result.action)} complete`}
        </div>
        {result.receipt ? (
          <OpenArtifactsReceiptView receipt={result.receipt} actions={closeButton} />
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
            ? "OpenArtifacts access required"
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
          <OpenArtifactsReceiptView receipt={result.receipt} actions={actions} />
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
      ? "Yes withdraws the link and deletes OpenArtifacts’s stored copy. Previously fetched or cached copies cannot be recalled."
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
            Review the rendered page in your default browser, then return here to confirm.
          </p>
          <a
            href={review.previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={review.previewPath}
            className="tw-text-accent tw-underline"
            onClick={(event) => {
              event.preventDefault();
              void presentPreview();
            }}
          >
            {previewOpened ? "Open preview again" : "Open local HTML preview"}
          </a>
          {previewFailed && (
            <div className="tw-flex tw-flex-col tw-gap-2">
              <p className="tw-m-0 tw-text-small tw-text-muted" role="alert">
                Could not open the browser preview. Retry the link, or open this file in your
                browser:
              </p>
              <code className="tw-break-all tw-text-small">{review.previewPath}</code>
              <label className="tw-flex tw-items-center tw-gap-2 tw-text-small">
                <Checkbox
                  checked={manuallyReviewed}
                  onCheckedChange={(checked) => setManuallyReviewed(checked === true)}
                />
                I reviewed the preview
              </label>
            </div>
          )}
        </div>
      )}

      <div
        className="tw-flex tw-flex-wrap tw-justify-end tw-gap-2"
        aria-label="OpenArtifacts actions"
      >
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
              disabled={working || (!!review && !canConfirmReview)}
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
 * Hosts the complete state-aware OpenArtifacts confirmation and result flow for one note.
 */
export class OpenArtifactsModal extends Modal {
  private root: Root | null = null;

  constructor(
    app: App,
    private readonly options: OpenArtifactsModalOptions
  ) {
    super(app);
    this.modalEl.classList.add("copilot-openartifacts-modal");
    this.titleEl.setText("Share with OpenArtifacts");
  }

  onOpen(): void {
    this.contentEl.empty();
    this.root = createPluginRoot(this.contentEl, this.app);
    this.root.render(<OpenArtifactsModalContent {...this.options} onClose={() => this.close()} />);
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
    this.options.onClosed?.();
  }
}

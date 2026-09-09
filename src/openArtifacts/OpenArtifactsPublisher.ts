import {
  OpenArtifactsModal,
  type OpenArtifactsFailureResult,
  type OpenArtifactsModalOptions,
  type OpenArtifactsModalResult,
  type OpenArtifactsPersistenceResult,
} from "@/components/modals/OpenArtifactsModal";
import { logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { OpenArtifactsClient, OpenArtifactsClientError } from "@/openArtifacts/OpenArtifactsClient";
import {
  OpenArtifactsFrontmatterParseError,
  getOpenArtifactsDocId,
  removeOpenArtifactsDocId,
  saveOpenArtifactsLink,
  OpenArtifactsPropertyConflictError,
} from "@/openArtifacts/openArtifactsFrontmatter";
import {
  buildOpenArtifactsDocument,
  OpenArtifactsDocumentTooLargeError,
} from "@/openArtifacts/openArtifactsDocument";
import {
  appendOpenArtifactsLedgerEntry,
  type OpenArtifactsLedgerEntry,
} from "@/openArtifacts/openArtifactsLedger";
import type {
  OpenArtifactsAction,
  OpenArtifactsDocument,
  OpenArtifactsReceipt,
} from "@/openArtifacts/types";
import { sha256 } from "@/utils/hash";
import { App, Component, TFile } from "obsidian";

interface OpenArtifactsClientPort {
  publish(document: OpenArtifactsDocument, licenseKey: string): Promise<OpenArtifactsReceipt>;
  update(
    docId: string,
    document: OpenArtifactsDocument,
    licenseKey: string
  ): Promise<OpenArtifactsReceipt>;
  delete(docId: string, licenseKey: string): Promise<void>;
}

interface OpenArtifactsModalPort {
  open(): void;
  close(): void;
}

interface OpenArtifactsPublisherDependencies {
  client?: OpenArtifactsClientPort;
  loadLicenseKey?: () => Promise<string>;
  buildDocument?: (file: TFile, ownerDocument: Document) => Promise<OpenArtifactsDocument>;
  createModal?: (options: OpenArtifactsModalOptions) => OpenArtifactsModalPort;
  recordLedger?: (entry: OpenArtifactsLedgerEntry) => Promise<void>;
}

const MISSING_LICENSE_MESSAGE =
  "Add a Copilot Plus license key in Settings before publishing with OpenArtifacts.";
const BUSY_MESSAGE = "An OpenArtifacts action is already in progress for this note.";

async function loadConfiguredLicenseKey(): Promise<string> {
  return getSettings().plusLicenseKey.trim();
}

async function buildDocumentWithComponent(
  app: App,
  file: TFile,
  ownerDocument: Document
): Promise<OpenArtifactsDocument> {
  const component = new Component();
  component.load();
  try {
    return await buildOpenArtifactsDocument(app, file, component, ownerDocument);
  } finally {
    component.unload();
  }
}

function operationFailure(action: OpenArtifactsAction, error: unknown): OpenArtifactsFailureResult {
  if (
    error instanceof OpenArtifactsFrontmatterParseError ||
    error instanceof OpenArtifactsPropertyConflictError
  ) {
    return {
      kind: "failure",
      action,
      message: error.message,
      accessNotice: false,
      retryable: false,
    };
  }
  if (error instanceof OpenArtifactsDocumentTooLargeError) {
    return {
      kind: "failure",
      action,
      message: error.message,
      accessNotice: false,
      retryable: false,
    };
  }
  if (error instanceof OpenArtifactsClientError) {
    return {
      kind: "failure",
      action,
      message: error.message,
      accessNotice: error.status === 401 && error.code === "unauthorized",
      retryable: error.retryable,
    };
  }

  return {
    kind: "failure",
    action,
    message: "Copilot could not complete this OpenArtifacts action.",
    accessNotice: false,
    retryable: true,
  };
}

function identityChangedFailure(action: OpenArtifactsAction): OpenArtifactsFailureResult {
  return {
    kind: "failure",
    action,
    message:
      "This note's OpenArtifacts identity changed. Close and reopen this dialog before trying again.",
    accessNotice: false,
    retryable: false,
  };
}

/**
 * Coordinates one note's confirmed OpenArtifacts action, remote request, and local identity update.
 *
 * The publisher owns per-file concurrency and partial-success recovery. It does not decide
 * OpenArtifacts entitlement or retain decrypted credentials beyond an individual request.
 */
export class OpenArtifactsPublisher {
  private readonly client: OpenArtifactsClientPort;
  private readonly loadLicenseKey: () => Promise<string>;
  private readonly buildDocument: (
    file: TFile,
    ownerDocument: Document
  ) => Promise<OpenArtifactsDocument>;
  private readonly createModal: (options: OpenArtifactsModalOptions) => OpenArtifactsModalPort;
  private readonly recordLedger: (entry: OpenArtifactsLedgerEntry) => Promise<void>;
  private readonly inFlightFiles = new Set<TFile>();
  private readonly blockedPublishResults = new Map<
    TFile,
    OpenArtifactsFailureResult | OpenArtifactsPersistenceResult
  >();
  private readonly modals = new Set<OpenArtifactsModalPort>();
  private disposed = false;

  constructor(
    private readonly app: App,
    dependencies: OpenArtifactsPublisherDependencies = {}
  ) {
    this.client = dependencies.client ?? new OpenArtifactsClient();
    this.loadLicenseKey = dependencies.loadLicenseKey ?? loadConfiguredLicenseKey;
    this.buildDocument =
      dependencies.buildDocument ??
      ((file, ownerDocument) => buildDocumentWithComponent(this.app, file, ownerDocument));
    this.createModal =
      dependencies.createModal ?? ((options) => new OpenArtifactsModal(this.app, options));
    this.recordLedger =
      dependencies.recordLedger ??
      ((entry) => appendOpenArtifactsLedgerEntry(this.app.vault, entry));
  }

  /**
   * Opens the state-aware confirmation flow for the exact file supplied by the caller.
   *
   * @param file The Markdown note selected by the invoking command or menu.
   */
  async open(file: TFile): Promise<void> {
    if (this.disposed) {
      return;
    }
    let docId: string | null = null;
    let initialResult: OpenArtifactsFailureResult | OpenArtifactsPersistenceResult | undefined =
      this.blockedPublishResults.get(file);
    if (!initialResult) {
      try {
        docId = await getOpenArtifactsDocId(this.app, file);
      } catch (error) {
        if (
          !(error instanceof OpenArtifactsFrontmatterParseError) &&
          !(error instanceof OpenArtifactsPropertyConflictError)
        ) {
          throw error;
        }
        initialResult = operationFailure("publish", error);
      }
    }
    if (this.disposed) {
      return;
    }
    const openingResult = initialResult;
    let modal: OpenArtifactsModalPort;
    modal = this.createModal({
      fileName: file.basename,
      docId,
      initialResult: openingResult,
      onConfirm: openingResult
        ? () => Promise.resolve(openingResult)
        : (action, ownerDocument) => this.execute(file, docId, action, ownerDocument),
      onClosed: () => this.modals.delete(modal),
    });
    this.modals.add(modal);
    try {
      modal.open();
    } catch (error) {
      this.modals.delete(modal);
      throw error;
    }
  }

  /**
   * Disables stale modal callbacks and closes this publisher's UI during plugin teardown.
   */
  dispose(): void {
    this.disposed = true;
    for (const modal of [...this.modals]) {
      modal.close();
    }
    this.modals.clear();
    this.blockedPublishResults.clear();
  }

  private async execute(
    file: TFile,
    expectedDocId: string | null,
    action: OpenArtifactsAction,
    ownerDocument: Document
  ): Promise<OpenArtifactsModalResult> {
    const expectedAction: OpenArtifactsAction = expectedDocId ? "update" : "publish";
    const deleteRequested = action === "delete";
    const lockAction = deleteRequested ? "delete" : expectedAction;
    return this.withFileLock(file, lockAction, async () => {
      if (this.disposed) {
        return {
          kind: "failure",
          action: lockAction,
          message: "OpenArtifacts publishing is no longer available.",
          accessNotice: false,
          retryable: false,
        };
      }
      const blockedResult = this.blockedPublishResults.get(file);
      if (blockedResult) {
        return blockedResult;
      }
      let docId: string | null;
      try {
        docId = await getOpenArtifactsDocId(this.app, file);
      } catch (error) {
        return operationFailure(lockAction, error);
      }
      if (docId !== expectedDocId) {
        return identityChangedFailure(lockAction);
      }
      const resolvedAction: OpenArtifactsAction = deleteRequested
        ? "delete"
        : docId
          ? "update"
          : "publish";

      let licenseKey: string;
      try {
        licenseKey = await this.loadLicenseKey();
      } catch {
        licenseKey = "";
      }
      if (!licenseKey) {
        return {
          kind: "failure",
          action: resolvedAction,
          message: MISSING_LICENSE_MESSAGE,
          accessNotice: true,
          retryable: false,
        };
      }

      if (resolvedAction === "delete" && !docId) {
        return {
          kind: "failure",
          action: resolvedAction,
          message: "This note no longer has a valid OpenArtifacts link.",
          accessNotice: false,
          retryable: false,
        };
      }

      try {
        if (resolvedAction === "delete") {
          if ((await getOpenArtifactsDocId(this.app, file)) !== docId) {
            return identityChangedFailure(resolvedAction);
          }
          await this.client.delete(docId!, licenseKey);
          await this.recordLedgerSafely({
            docId: docId!,
            status: "unpublished",
            notePath: file.path,
            url: null,
            publishedAt: null,
            version: null,
            contentHash: null,
          });
          return await this.removeLocalIdentity(file, docId!);
        }

        const document = await this.buildDocument(file, ownerDocument);
        const preRequestDocId = await getOpenArtifactsDocId(this.app, file);
        if (preRequestDocId !== docId) {
          return identityChangedFailure(resolvedAction);
        }
        if (!docId) {
          const receipt = await this.client.publish(document, licenseKey);
          await this.recordPublishedReceipt(file, document, receipt);
          return await this.savePublishedIdentity(file, receipt);
        }

        // A valid identity remains in this PUT-only branch. Any update failure
        // propagates to the failure result without a path back to POST.
        const receipt = await this.client.update(docId, document, licenseKey);
        await this.recordPublishedReceipt(file, document, receipt);
        // Saving is idempotent for a current identity and moves a legacy `symposium` key to
        // `openartifacts`, so every successful update completes the migration.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/395
        let saved = false;
        let currentDocId: string | null | undefined;
        try {
          currentDocId = await getOpenArtifactsDocId(this.app, file);
          if (currentDocId === docId) saved = await saveOpenArtifactsLink(this.app, file, receipt);
        } catch {
          // Remote success is still partial success when the local identity cannot be verified.
        }
        if (!saved) {
          const result: OpenArtifactsPersistenceResult = {
            kind: "persistence",
            action: "update",
            message:
              "The original page was updated, but this note’s OpenArtifacts identity changed or could not be verified. Its current identity was left unchanged.",
            receipt,
          };
          if (!currentDocId) {
            this.blockedPublishResults.set(file, result);
          }
          return result;
        }
        return { kind: "success", action: "update", receipt };
      } catch (error) {
        const failure = operationFailure(resolvedAction, error);
        if (error instanceof OpenArtifactsClientError && error.code === "ambiguous_publish") {
          this.blockedPublishResults.set(file, failure);
        }
        return failure;
      }
    });
  }

  private async recordPublishedReceipt(
    file: TFile,
    document: OpenArtifactsDocument,
    receipt: OpenArtifactsReceipt
  ): Promise<void> {
    await this.recordLedgerSafely({
      docId: receipt.docId,
      status: "published",
      notePath: file.path,
      url: receipt.url,
      publishedAt: new Date().toISOString(),
      version: receipt.version,
      contentHash: sha256(document.html),
    });
  }

  private async recordLedgerSafely(entry: OpenArtifactsLedgerEntry): Promise<void> {
    try {
      await this.recordLedger(entry);
    } catch (error) {
      logWarn("Could not append an OpenArtifacts receipt to the recoverable ledger.", error);
    }
  }

  private async savePublishedIdentity(
    file: TFile,
    receipt: OpenArtifactsReceipt
  ): Promise<OpenArtifactsModalResult> {
    try {
      const saved = await saveOpenArtifactsLink(this.app, file, receipt);
      if (!saved) {
        const result: OpenArtifactsPersistenceResult = {
          kind: "persistence",
          action: "publish",
          message:
            "The page is public, but this note’s OpenArtifacts identity changed or could not be verified. Its current frontmatter was left unchanged.",
          receipt,
        };
        let currentDocId: string | null | undefined;
        try {
          currentDocId = await getOpenArtifactsDocId(this.app, file);
        } catch {
          // A successful POST must stay blocked when no valid identity can route reopen to Update.
        }
        if (currentDocId) {
          this.blockedPublishResults.delete(file);
        } else {
          this.blockedPublishResults.set(file, result);
        }
        return result;
      }
      this.blockedPublishResults.delete(file);
      return { kind: "success", action: "publish", receipt };
    } catch {
      return this.publishPersistenceFailure(file, receipt);
    }
  }

  private publishPersistenceFailure(
    file: TFile,
    receipt: OpenArtifactsReceipt
  ): OpenArtifactsPersistenceResult {
    const result: OpenArtifactsPersistenceResult = {
      kind: "persistence",
      action: "publish",
      message:
        "The page is already public. Retry saving its link to this note; this will not publish again.",
      receipt,
      retrySave: () =>
        this.withFileLock(file, "publish", async () => this.savePublishedIdentity(file, receipt)),
    };
    this.blockedPublishResults.set(file, result);
    return result;
  }

  private async removeLocalIdentity(
    file: TFile,
    expectedDocId: string
  ): Promise<OpenArtifactsModalResult> {
    try {
      const removed = await removeOpenArtifactsDocId(this.app, file, expectedDocId);
      if (!removed) {
        this.blockedPublishResults.delete(file);
        return {
          kind: "persistence",
          action: "delete",
          message:
            "The original page was withdrawn, but this note now points to a different OpenArtifacts document. Its newer identity was left unchanged.",
        };
      }
      this.blockedPublishResults.delete(file);
      return { kind: "success", action: "delete" };
    } catch {
      return this.deletePersistenceFailure(file, expectedDocId);
    }
  }

  private deletePersistenceFailure(
    file: TFile,
    expectedDocId: string
  ): OpenArtifactsPersistenceResult {
    const result: OpenArtifactsPersistenceResult = {
      kind: "persistence",
      action: "delete",
      message:
        "The public page is already deleted. Retry removing its link from this note; this will not contact OpenArtifacts again.",
      retrySave: () =>
        this.withFileLock(file, "delete", async () =>
          this.removeLocalIdentity(file, expectedDocId)
        ),
    };
    this.blockedPublishResults.set(file, result);
    return result;
  }

  private async withFileLock(
    file: TFile,
    action: OpenArtifactsAction,
    operation: () => Promise<OpenArtifactsModalResult>
  ): Promise<OpenArtifactsModalResult> {
    if (this.inFlightFiles.has(file)) {
      return {
        kind: "failure",
        action,
        message: BUSY_MESSAGE,
        accessNotice: false,
        retryable: false,
      };
    }

    this.inFlightFiles.add(file);
    try {
      return await operation();
    } finally {
      this.inFlightFiles.delete(file);
    }
  }
}

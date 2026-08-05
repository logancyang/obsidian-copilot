import {
  SymposiumModal,
  type SymposiumDocumentReview,
  type SymposiumFailureResult,
  type SymposiumModalOptions,
  type SymposiumModalResult,
  type SymposiumPersistenceResult,
} from "@/components/modals/SymposiumModal";
import { logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { SymposiumClient, SymposiumClientError } from "@/symposium/SymposiumClient";
import type { SymposiumAgentHandoff } from "@/symposium/symposiumAgentHandoff";
import {
  SymposiumFrontmatterParseError,
  getSymposiumDocId,
  removeSymposiumDocId,
  saveSymposiumLink,
  SymposiumPropertyConflictError,
} from "@/symposium/symposiumFrontmatter";
import {
  buildSymposiumDocument,
  createSymposiumReviewDocument,
  SymposiumDocumentTooLargeError,
  SymposiumDocumentUnsafeError,
} from "@/symposium/symposiumDocument";
import { appendSymposiumLedgerEntry, type SymposiumLedgerEntry } from "@/symposium/symposiumLedger";
import type { SymposiumAction, SymposiumDocument, SymposiumReceipt } from "@/symposium/types";
import { sha256 } from "@/utils/hash";
import { App, Component, FileSystemAdapter, TFile } from "obsidian";

interface SymposiumClientPort {
  publish(document: SymposiumDocument, licenseKey: string): Promise<SymposiumReceipt>;
  update(docId: string, document: SymposiumDocument, licenseKey: string): Promise<SymposiumReceipt>;
  delete(docId: string, licenseKey: string): Promise<void>;
}

interface SymposiumModalPort {
  open(): void;
  close(): void;
}

interface SymposiumPublisherDependencies {
  client?: SymposiumClientPort;
  loadLicenseKey?: () => Promise<string>;
  buildDocument?: (file: TFile, ownerDocument: Document) => Promise<SymposiumDocument>;
  consumeAgentHandoff?: (stagedHtmlPath: string) => Promise<SymposiumAgentHandoff>;
  createModal?: (options: SymposiumModalOptions) => SymposiumModalPort;
  recordLedger?: (entry: SymposiumLedgerEntry) => Promise<void>;
}

/** Result returned to the agent wrapper after the host-owned review closes. */
export type AgentSymposiumReviewOutcome =
  | { status: "cancelled" | "regenerate" }
  | { status: "deleted" }
  | { status: "published" | "updated"; url: string; message?: string }
  | { status: "failed"; message: string };

/** Narrow runtime surface exposed to agent-controlled Obsidian CLI evaluations. */
export interface SymposiumAgentBridge {
  readonly reviewAgentManage: (sourcePathInput: string) => Promise<AgentSymposiumReviewOutcome>;
  readonly reviewAgentPublish: (
    sourcePathInput: string,
    stagedHtmlPathInput: string
  ) => Promise<AgentSymposiumReviewOutcome>;
}

const MISSING_LICENSE_MESSAGE =
  "Add a Copilot Plus license key in Settings before publishing with Symposium.";
const BUSY_MESSAGE = "A Symposium action is already in progress for this note.";
const INVALID_HANDOFF_PATH_MESSAGE =
  "Symposium review paths must be relative paths inside the current vault.";

/**
 * Normalizes one portable vault-relative path without allowing it to escape the vault.
 *
 * @param value The untrusted path supplied through the agent wrapper.
 */
function normalizeWorkspaceRelativePath(value: string): string | null {
  const portable = value.replace(/\\/g, "/");
  if (
    !portable ||
    portable.includes("\0") ||
    portable.startsWith("/") ||
    /^[A-Za-z]:\//.test(portable)
  ) {
    return null;
  }

  const segments: string[] = [];
  for (const segment of portable.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join("/") : null;
}

/**
 * Creates the stable failure envelope returned across the CLI bridge.
 *
 * @param message The user-safe host failure message.
 */
function agentReviewFailure(message: string): AgentSymposiumReviewOutcome {
  return { status: "failed", message };
}

/**
 * Converts the existing modal result into the narrow result understood by the agent wrapper.
 *
 * @param result The completed host publication or persistence result.
 */
function agentOutcomeFromModalResult(result: SymposiumModalResult): AgentSymposiumReviewOutcome {
  if (result.kind === "success" && result.action === "delete") {
    return { status: "deleted" };
  }
  if (
    (result.kind === "success" || result.kind === "persistence") &&
    result.action !== "delete" &&
    result.receipt
  ) {
    return {
      status: result.action === "publish" ? "published" : "updated",
      url: result.receipt.url,
      ...(result.kind === "persistence" ? { message: result.message } : {}),
    };
  }

  if (result.kind === "failure" || result.kind === "persistence") {
    return agentReviewFailure(result.message);
  }
  return agentReviewFailure("Copilot could not complete this Symposium action.");
}

async function loadConfiguredLicenseKey(): Promise<string> {
  return getSettings().plusLicenseKey.trim();
}

async function buildDocumentWithComponent(
  app: App,
  file: TFile,
  ownerDocument: Document
): Promise<SymposiumDocument> {
  const component = new Component();
  component.load();
  try {
    return await buildSymposiumDocument(app, file, component, ownerDocument);
  } finally {
    component.unload();
  }
}

function operationFailure(action: SymposiumAction, error: unknown): SymposiumFailureResult {
  if (
    error instanceof SymposiumFrontmatterParseError ||
    error instanceof SymposiumPropertyConflictError
  ) {
    return {
      kind: "failure",
      action,
      message: error.message,
      accessNotice: false,
      retryable: false,
    };
  }
  if (
    error instanceof SymposiumDocumentTooLargeError ||
    error instanceof SymposiumDocumentUnsafeError
  ) {
    return {
      kind: "failure",
      action,
      message: error.message,
      accessNotice: false,
      retryable: false,
    };
  }
  if (error instanceof SymposiumClientError) {
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
    message: "Copilot could not complete this Symposium action.",
    accessNotice: false,
    retryable: true,
  };
}

function identityChangedFailure(action: SymposiumAction): SymposiumFailureResult {
  return {
    kind: "failure",
    action,
    message:
      "This note's Symposium identity changed. Close and reopen this dialog before trying again.",
    accessNotice: false,
    retryable: false,
  };
}

function previewChangedFailure(action: SymposiumAction): SymposiumFailureResult {
  return {
    kind: "failure",
    action,
    message: "The local HTML preview changed. Ask the agent to regenerate it before publishing.",
    accessNotice: false,
    retryable: false,
  };
}

/**
 * Coordinates one note's confirmed Symposium action, remote request, and local identity update.
 *
 * The publisher owns per-file concurrency and partial-success recovery. It does not decide
 * Symposium entitlement or retain decrypted credentials beyond an individual request.
 */
export class SymposiumPublisher {
  private readonly client: SymposiumClientPort;
  private readonly loadLicenseKey: () => Promise<string>;
  private readonly buildDocument: (
    file: TFile,
    ownerDocument: Document
  ) => Promise<SymposiumDocument>;
  private readonly consumeAgentHandoff: (stagedHtmlPath: string) => Promise<SymposiumAgentHandoff>;
  private readonly createModal: (options: SymposiumModalOptions) => SymposiumModalPort;
  private readonly recordLedger: (entry: SymposiumLedgerEntry) => Promise<void>;
  private readonly inFlightFiles = new Set<TFile>();
  private readonly blockedPublishResults = new Map<
    TFile,
    SymposiumFailureResult | SymposiumPersistenceResult
  >();
  private readonly modals = new Set<SymposiumModalPort>();
  private disposed = false;

  constructor(
    private readonly app: App,
    dependencies: SymposiumPublisherDependencies = {}
  ) {
    this.client = dependencies.client ?? new SymposiumClient();
    this.loadLicenseKey = dependencies.loadLicenseKey ?? loadConfiguredLicenseKey;
    this.buildDocument =
      dependencies.buildDocument ??
      ((file, ownerDocument) => buildDocumentWithComponent(this.app, file, ownerDocument));
    this.consumeAgentHandoff =
      dependencies.consumeAgentHandoff ??
      ((stagedHtmlPath) => this.consumeDesktopAgentHandoff(stagedHtmlPath));
    this.createModal =
      dependencies.createModal ?? ((options) => new SymposiumModal(this.app, options));
    this.recordLedger =
      dependencies.recordLedger ?? ((entry) => appendSymposiumLedgerEntry(this.app.vault, entry));
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
    let initialResult: SymposiumFailureResult | SymposiumPersistenceResult | undefined =
      this.blockedPublishResults.get(file);
    if (!initialResult) {
      try {
        docId = await getSymposiumDocId(this.app, file);
      } catch (error) {
        if (
          !(error instanceof SymposiumFrontmatterParseError) &&
          !(error instanceof SymposiumPropertyConflictError)
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
    let modal: SymposiumModalPort;
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
   * Opens the existing host-owned management modal for a published source note.
   * The agent supplies only the source path; the user chooses Update or Delete in Obsidian.
   *
   * @param sourcePathInput The Markdown source path relative to the owning vault.
   */
  async reviewAgentManage(sourcePathInput: string): Promise<AgentSymposiumReviewOutcome> {
    const sourcePath = normalizeWorkspaceRelativePath(sourcePathInput);
    if (!sourcePath) {
      return agentReviewFailure(INVALID_HANDOFF_PATH_MESSAGE);
    }
    if (this.disposed) {
      return agentReviewFailure("Symposium publishing is no longer available.");
    }

    const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(sourceFile instanceof TFile) || sourceFile.extension !== "md") {
      return agentReviewFailure("The Symposium source must be an existing Markdown note.");
    }
    const blockedResult = this.blockedPublishResults.get(sourceFile);
    if (blockedResult) {
      return agentReviewFailure(blockedResult.message);
    }

    let docId: string | null;
    try {
      docId = await getSymposiumDocId(this.app, sourceFile);
    } catch (error) {
      return agentReviewFailure(operationFailure("update", error).message);
    }
    if (!docId) {
      return agentReviewFailure("This note does not have a valid Symposium link to manage.");
    }
    return this.openAgentManage(sourceFile, docId);
  }

  /**
   * Consumes agent-finished HTML and opens a host-owned review before any network request.
   * The bridge accepts paths only; note identity and POST-versus-PUT routing remain inside the host.
   *
   * @param sourcePathInput The Markdown source path relative to the owning vault.
   * @param stagedHtmlPathInput The unique HTML handoff path under the reserved staging folder.
   */
  async reviewAgentPublish(
    sourcePathInput: string,
    stagedHtmlPathInput: string
  ): Promise<AgentSymposiumReviewOutcome> {
    const stagedHtmlPath = normalizeWorkspaceRelativePath(stagedHtmlPathInput);
    if (!stagedHtmlPath) {
      return agentReviewFailure(INVALID_HANDOFF_PATH_MESSAGE);
    }
    let handoff: SymposiumAgentHandoff;
    try {
      handoff = await this.consumeAgentHandoff(stagedHtmlPath);
    } catch (error) {
      return agentReviewFailure(
        error instanceof Error && error.name === "SymposiumAgentHandoffError"
          ? error.message
          : "Copilot could not read the staged Symposium HTML."
      );
    }

    try {
      const sourcePath = normalizeWorkspaceRelativePath(sourcePathInput);
      if (!sourcePath) {
        return agentReviewFailure(INVALID_HANDOFF_PATH_MESSAGE);
      }

      if (this.disposed) {
        return agentReviewFailure("Symposium publishing is no longer available.");
      }

      const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!(sourceFile instanceof TFile) || sourceFile.extension !== "md") {
        return agentReviewFailure("The Symposium source must be an existing Markdown note.");
      }
      const blockedResult = this.blockedPublishResults.get(sourceFile);
      if (blockedResult) {
        return agentReviewFailure(blockedResult.message);
      }

      let document: SymposiumDocument;
      let docId: string | null = null;
      try {
        document = createSymposiumReviewDocument(sourceFile.basename, handoff.html);
        docId = await getSymposiumDocId(this.app, sourceFile);
      } catch (error) {
        const action: SymposiumAction = docId ? "update" : "publish";
        return agentReviewFailure(operationFailure(action, error).message);
      }

      const review: SymposiumDocumentReview = Object.freeze({
        sourcePath,
        digest: sha256(document.html),
        payload: document,
        previewPath: handoff.previewPath,
        previewUrl: handoff.previewUrl,
      });
      return await this.openAgentReview(sourceFile, docId, review, handoff.isPreviewCurrent);
    } finally {
      try {
        await handoff.cleanup();
      } catch (error) {
        logWarn("Could not remove the temporary Symposium browser preview.", error);
      }
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

  /**
   * Resolves the desktop vault root required by the filesystem-safe agent bridge.
   */
  private getDesktopVaultRoot(): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Symposium agent review requires a desktop vault.");
    }
    return adapter.getBasePath();
  }

  /**
   * Lazily loads the Node-only exact-byte consumer so native mobile publishing still loads.
   *
   * @param stagedHtmlPath The validated vault-relative staging path.
   */
  private async consumeDesktopAgentHandoff(stagedHtmlPath: string): Promise<SymposiumAgentHandoff> {
    const { consumeSymposiumAgentHandoff } = await import("@/symposium/symposiumAgentHandoff");
    return consumeSymposiumAgentHandoff(this.getDesktopVaultRoot(), stagedHtmlPath);
  }

  private isAgentSourceCurrent(file: TFile, sourcePath: string): boolean {
    return file.path === sourcePath && this.app.vault.getAbstractFileByPath(sourcePath) === file;
  }

  private openAgentManage(
    file: TFile,
    expectedDocId: string
  ): Promise<AgentSymposiumReviewOutcome> {
    return new Promise((resolve) => {
      let pending = false;
      let settled = false;
      const settle = (outcome: AgentSymposiumReviewOutcome): void => {
        if (settled) return;
        settled = true;
        resolve(outcome);
      };

      let modal: SymposiumModalPort;
      modal = this.createModal({
        fileName: file.basename,
        docId: expectedDocId,
        onConfirm: async (action, ownerDocument) => {
          pending = true;
          try {
            const result = await this.execute(file, expectedDocId, action, ownerDocument);
            settle(agentOutcomeFromModalResult(result));
            return result;
          } catch (error) {
            const result = operationFailure(action, error);
            settle(agentOutcomeFromModalResult(result));
            return result;
          } finally {
            pending = false;
          }
        },
        onClosed: () => {
          this.modals.delete(modal);
          if (!pending) {
            settle({ status: "cancelled" });
          }
        },
      });
      this.modals.add(modal);
      try {
        modal.open();
      } catch {
        this.modals.delete(modal);
        settle(agentReviewFailure("Copilot could not open Symposium management."));
      }
    });
  }

  /**
   * Opens a review whose result remains bound to the captured document and source identity.
   *
   * @param file The source note resolved by the host.
   * @param expectedDocId The source identity read immediately before opening review.
   * @param review The frozen document and digest shown to the user.
   * @param isPreviewCurrent Verifies that the temporary browser file still contains the reviewed bytes.
   */
  private openAgentReview(
    file: TFile,
    expectedDocId: string | null,
    review: SymposiumDocumentReview,
    isPreviewCurrent: () => Promise<boolean>
  ): Promise<AgentSymposiumReviewOutcome> {
    return new Promise((resolve) => {
      let pending = false;
      let settled = false;
      const settle = (outcome: AgentSymposiumReviewOutcome): void => {
        if (settled) return;
        settled = true;
        resolve(outcome);
      };

      let modal: SymposiumModalPort;
      modal = this.createModal({
        fileName: file.basename,
        docId: expectedDocId,
        review,
        onConfirm: async (action, ownerDocument) => {
          pending = true;
          try {
            const result = await this.execute(
              file,
              expectedDocId,
              action,
              ownerDocument,
              review,
              isPreviewCurrent
            );
            settle(agentOutcomeFromModalResult(result));
            return result;
          } catch (error) {
            const result = operationFailure(expectedDocId ? "update" : "publish", error);
            settle(agentOutcomeFromModalResult(result));
            return result;
          } finally {
            pending = false;
          }
        },
        onRegenerate: () => settle({ status: "regenerate" }),
        onClosed: () => {
          this.modals.delete(modal);
          if (!pending) {
            settle({ status: "cancelled" });
          }
        },
      });
      this.modals.add(modal);
      try {
        modal.open();
      } catch {
        this.modals.delete(modal);
        settle(agentReviewFailure("Copilot could not open the Symposium review."));
      }
    });
  }

  private async execute(
    file: TFile,
    expectedDocId: string | null,
    action: SymposiumAction,
    ownerDocument: Document,
    review?: SymposiumDocumentReview,
    isPreviewCurrent?: () => Promise<boolean>
  ): Promise<SymposiumModalResult> {
    const expectedAction: SymposiumAction = expectedDocId ? "update" : "publish";
    const deleteRequested = !review && action === "delete";
    const lockAction = deleteRequested ? "delete" : expectedAction;
    return this.withFileLock(file, lockAction, async () => {
      if (this.disposed) {
        return {
          kind: "failure",
          action: lockAction,
          message: "Symposium publishing is no longer available.",
          accessNotice: false,
          retryable: false,
        };
      }
      const blockedResult = this.blockedPublishResults.get(file);
      if (blockedResult) {
        return review
          ? {
              kind: "failure",
              action: lockAction,
              message: blockedResult.message,
              accessNotice: false,
              retryable: false,
            }
          : blockedResult;
      }
      if (review && !this.isAgentSourceCurrent(file, review.sourcePath)) {
        return identityChangedFailure(lockAction);
      }
      let docId: string | null;
      try {
        docId = await getSymposiumDocId(this.app, file);
      } catch (error) {
        return operationFailure(lockAction, error);
      }
      if (docId !== expectedDocId) {
        return identityChangedFailure(lockAction);
      }
      const resolvedAction: SymposiumAction = deleteRequested
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
          message: "This note no longer has a valid Symposium link.",
          accessNotice: false,
          retryable: false,
        };
      }

      try {
        if (resolvedAction === "delete") {
          if ((await getSymposiumDocId(this.app, file)) !== docId) {
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

        const document = review?.payload ?? (await this.buildDocument(file, ownerDocument));
        const preRequestDocId = await getSymposiumDocId(this.app, file);
        if (
          preRequestDocId !== docId ||
          (review && !this.isAgentSourceCurrent(file, review.sourcePath))
        ) {
          return identityChangedFailure(resolvedAction);
        }
        if (review && !(await isPreviewCurrent?.())) {
          return previewChangedFailure(resolvedAction);
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
        let currentDocId: string | null | undefined;
        try {
          currentDocId = await getSymposiumDocId(this.app, file);
        } catch {
          // Remote success is still partial success when the local identity cannot be verified.
        }
        if (currentDocId !== docId) {
          const result: SymposiumPersistenceResult = {
            kind: "persistence",
            action: "update",
            message:
              "The original page was updated, but this note’s Symposium identity changed or could not be verified. Its current identity was left unchanged.",
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
        if (error instanceof SymposiumClientError && error.code === "ambiguous_publish") {
          this.blockedPublishResults.set(file, failure);
        }
        return failure;
      }
    });
  }

  private async recordPublishedReceipt(
    file: TFile,
    document: SymposiumDocument,
    receipt: SymposiumReceipt
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

  private async recordLedgerSafely(entry: SymposiumLedgerEntry): Promise<void> {
    try {
      await this.recordLedger(entry);
    } catch (error) {
      logWarn("Could not append a Symposium receipt to the recoverable ledger.", error);
    }
  }

  private async savePublishedIdentity(
    file: TFile,
    receipt: SymposiumReceipt
  ): Promise<SymposiumModalResult> {
    try {
      const saved = await saveSymposiumLink(this.app, file, receipt);
      if (!saved) {
        const result: SymposiumPersistenceResult = {
          kind: "persistence",
          action: "publish",
          message:
            "The page is public, but this note’s Symposium identity changed or could not be verified. Its current frontmatter was left unchanged.",
          receipt,
        };
        let currentDocId: string | null | undefined;
        try {
          currentDocId = await getSymposiumDocId(this.app, file);
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
    receipt: SymposiumReceipt
  ): SymposiumPersistenceResult {
    const result: SymposiumPersistenceResult = {
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
  ): Promise<SymposiumModalResult> {
    try {
      const removed = await removeSymposiumDocId(this.app, file, expectedDocId);
      if (!removed) {
        this.blockedPublishResults.delete(file);
        return {
          kind: "persistence",
          action: "delete",
          message:
            "The original page was withdrawn, but this note now points to a different Symposium document. Its newer identity was left unchanged.",
        };
      }
      this.blockedPublishResults.delete(file);
      return { kind: "success", action: "delete" };
    } catch {
      return this.deletePersistenceFailure(file, expectedDocId);
    }
  }

  private deletePersistenceFailure(file: TFile, expectedDocId: string): SymposiumPersistenceResult {
    const result: SymposiumPersistenceResult = {
      kind: "persistence",
      action: "delete",
      message:
        "The public page is already deleted. Retry removing its link from this note; this will not contact Symposium again.",
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
    action: SymposiumAction,
    operation: () => Promise<SymposiumModalResult>
  ): Promise<SymposiumModalResult> {
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

/**
 * Creates the frozen, path-only facade available to Agent Mode scripts. The
 * narrow shape prevents accidental routing choices; it is not a credential or
 * authorization boundary while agent processes retain the Plus license key.
 *
 * @param publisher The lifecycle-owned trusted Symposium publisher.
 */
export function createSymposiumAgentBridge(
  publisher: SymposiumPublisher
): Readonly<SymposiumAgentBridge> {
  return Object.freeze({
    reviewAgentManage: (sourcePathInput: string) => publisher.reviewAgentManage(sourcePathInput),
    reviewAgentPublish: (sourcePathInput: string, stagedHtmlPathInput: string) =>
      publisher.reviewAgentPublish(sourcePathInput, stagedHtmlPathInput),
  });
}

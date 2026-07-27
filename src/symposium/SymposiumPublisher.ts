import {
  SymposiumModal,
  type SymposiumFailureResult,
  type SymposiumModalOptions,
  type SymposiumModalResult,
  type SymposiumPersistenceResult,
} from "@/components/modals/SymposiumModal";
import { getDecryptedKey } from "@/encryptionService";
import { getSettings } from "@/settings/model";
import { SymposiumClient, SymposiumClientError } from "@/symposium/SymposiumClient";
import {
  getSymposiumDocId,
  removeSymposiumDocId,
  saveSymposiumDocId,
} from "@/symposium/symposiumFrontmatter";
import { buildSymposiumDocument } from "@/symposium/symposiumDocument";
import type { SymposiumAction, SymposiumDocument, SymposiumReceipt } from "@/symposium/types";
import { App, Component, TFile } from "obsidian";

interface SymposiumClientPort {
  publish(document: SymposiumDocument, licenseKey: string): Promise<SymposiumReceipt>;
  update(docId: string, document: SymposiumDocument, licenseKey: string): Promise<SymposiumReceipt>;
  delete(docId: string, licenseKey: string): Promise<void>;
}

interface SymposiumModalPort {
  open(): void;
}

interface SymposiumPublisherDependencies {
  client?: SymposiumClientPort;
  loadLicenseKey?: () => Promise<string>;
  buildDocument?: (file: TFile, ownerDocument: Document) => Promise<SymposiumDocument>;
  createModal?: (options: SymposiumModalOptions) => SymposiumModalPort;
}

const MISSING_LICENSE_MESSAGE =
  "Add a Copilot Plus license key in Settings before publishing with Symposium.";
const BUSY_MESSAGE = "A Symposium action is already in progress for this note.";

async function loadConfiguredLicenseKey(): Promise<string> {
  const configuredKey = getSettings().plusLicenseKey;
  return configuredKey ? (await getDecryptedKey(configuredKey)).trim() : "";
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
  private readonly createModal: (options: SymposiumModalOptions) => SymposiumModalPort;
  private readonly inFlightFiles = new Set<TFile>();

  constructor(
    private readonly app: App,
    dependencies: SymposiumPublisherDependencies = {}
  ) {
    this.client = dependencies.client ?? new SymposiumClient();
    this.loadLicenseKey = dependencies.loadLicenseKey ?? loadConfiguredLicenseKey;
    this.buildDocument =
      dependencies.buildDocument ??
      ((file, ownerDocument) => buildDocumentWithComponent(this.app, file, ownerDocument));
    this.createModal =
      dependencies.createModal ?? ((options) => new SymposiumModal(this.app, options));
  }

  /**
   * Opens the state-aware confirmation flow for the exact file supplied by the caller.
   *
   * @param file The Markdown note selected by the invoking command or menu.
   */
  async open(file: TFile): Promise<void> {
    const docId = getSymposiumDocId(this.app, file);
    this.createModal({
      fileName: file.basename,
      docId,
      onConfirm: (action, ownerDocument) => this.execute(file, docId, action, ownerDocument),
    }).open();
  }

  private async execute(
    file: TFile,
    expectedDocId: string | null,
    action: SymposiumAction,
    ownerDocument: Document
  ): Promise<SymposiumModalResult> {
    return this.withFileLock(file, action, async () => {
      const docId = getSymposiumDocId(this.app, file);
      if (docId !== expectedDocId) {
        return {
          kind: "failure",
          action,
          message:
            "This note's Symposium identity changed. Close and reopen this dialog before trying again.",
          accessNotice: false,
          retryable: false,
        };
      }

      let licenseKey: string;
      try {
        licenseKey = await this.loadLicenseKey();
      } catch {
        licenseKey = "";
      }
      if (!licenseKey) {
        return {
          kind: "failure",
          action,
          message: MISSING_LICENSE_MESSAGE,
          accessNotice: true,
          retryable: false,
        };
      }

      if (action !== "publish" && !docId) {
        return {
          kind: "failure",
          action,
          message: "This note no longer has a valid Symposium document id.",
          accessNotice: false,
          retryable: false,
        };
      }

      try {
        if (action === "delete") {
          await this.client.delete(docId!, licenseKey);
          return await this.removeLocalIdentity(file);
        }

        const document = await this.buildDocument(file, ownerDocument);
        if (action === "publish") {
          const receipt = await this.client.publish(document, licenseKey);
          return await this.savePublishedIdentity(file, receipt);
        }

        try {
          const receipt = await this.client.update(docId!, document, licenseKey);
          return { kind: "success", action: "update", receipt };
        } catch (error) {
          if (
            !(error instanceof SymposiumClientError) ||
            error.status !== 404 ||
            error.code !== "not_found"
          ) {
            throw error;
          }
        }

        const receipt = await this.client.publish(document, licenseKey);
        return await this.savePublishedIdentity(file, receipt);
      } catch (error) {
        return operationFailure(action, error);
      }
    });
  }

  private async savePublishedIdentity(
    file: TFile,
    receipt: SymposiumReceipt
  ): Promise<SymposiumModalResult> {
    try {
      await saveSymposiumDocId(this.app, file, receipt.docId);
      return { kind: "success", action: "publish", receipt };
    } catch {
      return this.publishPersistenceFailure(file, receipt);
    }
  }

  private publishPersistenceFailure(
    file: TFile,
    receipt: SymposiumReceipt
  ): SymposiumPersistenceResult {
    return {
      kind: "persistence",
      action: "publish",
      message:
        "The page is already public. Retry saving its document id to this note; this will not publish again.",
      receipt,
      retrySave: () =>
        this.withFileLock(file, "publish", async () => this.savePublishedIdentity(file, receipt)),
    };
  }

  private async removeLocalIdentity(file: TFile): Promise<SymposiumModalResult> {
    try {
      await removeSymposiumDocId(this.app, file);
      return { kind: "success", action: "delete" };
    } catch {
      return this.deletePersistenceFailure(file);
    }
  }

  private deletePersistenceFailure(file: TFile): SymposiumPersistenceResult {
    return {
      kind: "persistence",
      action: "delete",
      message:
        "The public page is already deleted. Retry removing its document id from this note; this will not contact Symposium again.",
      retrySave: () =>
        this.withFileLock(file, "delete", async () => this.removeLocalIdentity(file)),
    };
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

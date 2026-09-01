import {
  OPENARTIFACTS_API_ORIGIN,
  OPENARTIFACTS_DOCUMENT_ORIGIN,
  OPENARTIFACTS_DOC_ID_PATTERN,
} from "@/openArtifacts/constants";
import type {
  OpenArtifactsDocument,
  OpenArtifactsErrorResponse,
  OpenArtifactsReceipt,
} from "@/openArtifacts/types";
import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";

const DOCS_ENDPOINT = `${OPENARTIFACTS_API_ORIGIN}/api/v1/docs`;
const NETWORK_ERROR_MESSAGE = "Could not reach OpenArtifacts. Please try again.";
const AMBIGUOUS_PUBLISH_MESSAGE =
  "OpenArtifacts may have published this note, but Copilot did not receive a valid receipt. To avoid creating a duplicate page, this publish cannot be retried until the plugin reloads.";

/**
 * Carries an OpenArtifacts failure to the UI without interpreting server-side authorization policy.
 */
export class OpenArtifactsClientError extends Error {
  /**
   * @param message The human-readable server message or a transport-safe fallback.
   * @param code The stable server error code or a client transport/validation code.
   * @param status The HTTP status, or null when no response was received.
   * @param retryable Whether retrying the same operation can resolve the failure.
   */
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number | null,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "OpenArtifactsClientError";
    Object.setPrototypeOf(this, OpenArtifactsClientError.prototype);
  }
}

/**
 * Owns the fixed OpenArtifacts HTTP wire contract without managing credentials or note identity.
 */
export class OpenArtifactsClient {
  /**
   * @param document The complete HTML document to publish.
   * @param licenseKey The decrypted license key used only for this request.
   */
  async publish(
    document: OpenArtifactsDocument,
    licenseKey: string
  ): Promise<OpenArtifactsReceipt> {
    return this.push("POST", DOCS_ENDPOINT, document, licenseKey);
  }

  /**
   * @param docId The existing OpenArtifacts document identity.
   * @param document The complete HTML document for the new version.
   * @param licenseKey The decrypted license key used only for this request.
   */
  async update(
    docId: string,
    document: OpenArtifactsDocument,
    licenseKey: string
  ): Promise<OpenArtifactsReceipt> {
    return this.push(
      "PUT",
      `${DOCS_ENDPOINT}/${encodeURIComponent(docId)}`,
      document,
      licenseKey,
      docId
    );
  }

  /**
   * @param docId The OpenArtifacts document identity to withdraw.
   * @param licenseKey The decrypted license key used only for this request.
   */
  async delete(docId: string, licenseKey: string): Promise<void> {
    const response = await this.request({
      url: `${DOCS_ENDPOINT}/${encodeURIComponent(docId)}`,
      method: "DELETE",
      headers: authorizationHeaders(licenseKey),
      throw: false,
    });

    if (response.status === 204) {
      return;
    }

    const error = errorFromResponse(response);
    if (response.status === 404 && error.code === "not_found") {
      return;
    }
    throw error;
  }

  private async push(
    method: "POST" | "PUT",
    url: string,
    document: OpenArtifactsDocument,
    licenseKey: string,
    expectedDocId?: string
  ): Promise<OpenArtifactsReceipt> {
    let response: RequestUrlResponse;
    try {
      response = await this.request({
        url,
        method,
        headers: authorizationHeaders(licenseKey),
        contentType: "application/json",
        body: JSON.stringify({ title: document.title, html: document.html }),
        throw: false,
      });
    } catch (error) {
      if (
        method === "POST" &&
        error instanceof OpenArtifactsClientError &&
        error.code === "network"
      ) {
        throw ambiguousPublishError(null);
      }
      throw error;
    }
    const expectedStatus = method === "POST" ? 201 : 200;
    if (response.status !== expectedStatus) {
      if (response.status < 200 || response.status >= 300) {
        throw errorFromResponse(response);
      }
      if (method === "POST") {
        throw ambiguousPublishError(response.status);
      }
      throw malformedResponse(response.status);
    }

    try {
      return parseReceipt(response, expectedDocId);
    } catch (error) {
      if (
        method === "POST" &&
        error instanceof OpenArtifactsClientError &&
        error.code === "malformed_response"
      ) {
        throw ambiguousPublishError(response.status);
      }
      throw error;
    }
  }

  private async request(options: RequestUrlParam): Promise<RequestUrlResponse> {
    try {
      return await requestUrl(options);
    } catch {
      throw new OpenArtifactsClientError(NETWORK_ERROR_MESSAGE, "network", null, true);
    }
  }
}

function authorizationHeaders(licenseKey: string): Record<string, string> {
  return { Authorization: `Bearer ${licenseKey}` };
}

function parseReceipt(response: RequestUrlResponse, expectedDocId?: string): OpenArtifactsReceipt {
  const value = responseJson(response);
  if (!isRecord(value)) {
    throw malformedResponse(response.status);
  }

  const { docId, url, version } = value;
  if (
    typeof docId !== "string" ||
    !OPENARTIFACTS_DOC_ID_PATTERN.test(docId) ||
    (expectedDocId !== undefined && docId !== expectedDocId) ||
    typeof url !== "string" ||
    !isOpenArtifactsDocumentUrl(url, docId) ||
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    throw malformedResponse(response.status);
  }

  return { docId, url, version };
}

function errorFromResponse(response: RequestUrlResponse): OpenArtifactsClientError {
  const value = responseJson(response);
  if (!isErrorResponse(value)) {
    return malformedResponse(response.status);
  }

  const { code, message } = value.error;
  return new OpenArtifactsClientError(
    message,
    code,
    response.status,
    code === "internal" || response.status >= 500
  );
}

function responseJson(response: RequestUrlResponse): unknown {
  try {
    return response.json;
  } catch {
    return undefined;
  }
}

function isErrorResponse(value: unknown): value is OpenArtifactsErrorResponse {
  if (!isRecord(value) || !isRecord(value.error)) {
    return false;
  }
  return (
    typeof value.error.code === "string" &&
    value.error.code.length > 0 &&
    typeof value.error.message === "string" &&
    value.error.message.length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOpenArtifactsDocumentUrl(value: string, docId: string): boolean {
  try {
    const url = new URL(value);
    // New server receipts must use the canonical document host; the legacy host is accepted only
    // when reading an identity already persisted in a note.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/337
    return (
      url.origin === OPENARTIFACTS_DOCUMENT_ORIGIN &&
      url.pathname.replace(/\/$/, "") === `/d/${docId}`
    );
  } catch {
    return false;
  }
}

function malformedResponse(status: number): OpenArtifactsClientError {
  return new OpenArtifactsClientError(
    `OpenArtifacts returned an invalid response (HTTP ${status}).`,
    "malformed_response",
    status,
    status >= 500
  );
}

function ambiguousPublishError(status: number | null): OpenArtifactsClientError {
  return new OpenArtifactsClientError(
    AMBIGUOUS_PUBLISH_MESSAGE,
    "ambiguous_publish",
    status,
    false
  );
}

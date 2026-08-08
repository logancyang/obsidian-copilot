import { SYMPOSIUM_API_ORIGIN, SYMPOSIUM_DOC_ID_PATTERN } from "@/symposium/constants";
import type {
  SymposiumDocument,
  SymposiumErrorResponse,
  SymposiumReceipt,
} from "@/symposium/types";
import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";

const DOCS_ENDPOINT = `${SYMPOSIUM_API_ORIGIN}/api/v1/docs`;
const NETWORK_ERROR_MESSAGE = "Could not reach Symposium. Please try again.";
const AMBIGUOUS_PUBLISH_MESSAGE =
  "Symposium may have published this note, but Copilot did not receive a valid receipt. To avoid creating a duplicate page, this publish cannot be retried until the plugin reloads.";

/**
 * Carries a Symposium failure to the UI without interpreting server-side authorization policy.
 */
export class SymposiumClientError extends Error {
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
    this.name = "SymposiumClientError";
    Object.setPrototypeOf(this, SymposiumClientError.prototype);
  }
}

/**
 * Owns the fixed Symposium HTTP wire contract without managing credentials or note identity.
 */
export class SymposiumClient {
  /**
   * @param document The complete HTML document to publish.
   * @param licenseKey The decrypted license key used only for this request.
   */
  async publish(document: SymposiumDocument, licenseKey: string): Promise<SymposiumReceipt> {
    return this.push("POST", DOCS_ENDPOINT, document, licenseKey);
  }

  /**
   * @param docId The existing Symposium document identity.
   * @param document The complete HTML document for the new version.
   * @param licenseKey The decrypted license key used only for this request.
   */
  async update(
    docId: string,
    document: SymposiumDocument,
    licenseKey: string
  ): Promise<SymposiumReceipt> {
    return this.push(
      "PUT",
      `${DOCS_ENDPOINT}/${encodeURIComponent(docId)}`,
      document,
      licenseKey,
      docId
    );
  }

  /**
   * @param docId The Symposium document identity to withdraw.
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
    document: SymposiumDocument,
    licenseKey: string,
    expectedDocId?: string
  ): Promise<SymposiumReceipt> {
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
      if (method === "POST" && error instanceof SymposiumClientError && error.code === "network") {
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
        error instanceof SymposiumClientError &&
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
      throw new SymposiumClientError(NETWORK_ERROR_MESSAGE, "network", null, true);
    }
  }
}

function authorizationHeaders(licenseKey: string): Record<string, string> {
  return { Authorization: `Bearer ${licenseKey}` };
}

function parseReceipt(response: RequestUrlResponse, expectedDocId?: string): SymposiumReceipt {
  const value = responseJson(response);
  if (!isRecord(value)) {
    throw malformedResponse(response.status);
  }

  const { docId, url, version } = value;
  if (
    typeof docId !== "string" ||
    !SYMPOSIUM_DOC_ID_PATTERN.test(docId) ||
    (expectedDocId !== undefined && docId !== expectedDocId) ||
    typeof url !== "string" ||
    !isHttpsUrl(url) ||
    new URL(url).pathname.replace(/\/$/, "") !== `/d/${docId}` ||
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    throw malformedResponse(response.status);
  }

  return { docId, url, version };
}

function errorFromResponse(response: RequestUrlResponse): SymposiumClientError {
  const value = responseJson(response);
  if (!isErrorResponse(value)) {
    return malformedResponse(response.status);
  }

  const { code, message } = value.error;
  return new SymposiumClientError(
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

function isErrorResponse(value: unknown): value is SymposiumErrorResponse {
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

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function malformedResponse(status: number): SymposiumClientError {
  return new SymposiumClientError(
    `Symposium returned an invalid response (HTTP ${status}).`,
    "malformed_response",
    status,
    status >= 500
  );
}

function ambiguousPublishError(status: number | null): SymposiumClientError {
  return new SymposiumClientError(AMBIGUOUS_PUBLISH_MESSAGE, "ambiguous_publish", status, false);
}

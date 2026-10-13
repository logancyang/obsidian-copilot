import {
  OPENARTIFACTS_API_ORIGIN,
  OPENARTIFACTS_DOCUMENT_ORIGIN,
  OPENARTIFACTS_DOC_ID_PATTERN,
} from "@/openArtifacts/constants";
import type {
  OpenArtifactsAccess,
  OpenArtifactsDocument,
  OpenArtifactsErrorResponse,
  OpenArtifactsLinkAccess,
  OpenArtifactsReceipt,
} from "@/openArtifacts/types";
import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";

const DOCS_ENDPOINT = `${OPENARTIFACTS_API_ORIGIN}/api/v1/docs`;
const NETWORK_ERROR_MESSAGE = "Could not reach OpenArtifacts. Please try again.";
const PRIVATE_UNSUPPORTED_MESSAGE =
  "This OpenArtifacts server does not support private documents. Copilot removed the new page; nothing was published.";
const AMBIGUOUS_PUBLISH_MESSAGE =
  "OpenArtifacts may have published this note, but Copilot did not receive a valid receipt. To avoid creating a duplicate page, this publish cannot be retried until the plugin reloads.";

export class OpenArtifactsClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
    public readonly upgradeUrl?: string
  ) {
    super(message);
    this.name = "OpenArtifactsClientError";
    Object.setPrototypeOf(this, OpenArtifactsClientError.prototype);
  }
}

export class OpenArtifactsClient {
  async publish(
    document: OpenArtifactsDocument,
    licenseKey: string,
    linkAccess?: OpenArtifactsLinkAccess
  ): Promise<OpenArtifactsReceipt> {
    const receipt = await this.push(
      "POST",
      DOCS_ENDPOINT,
      document,
      licenseKey,
      undefined,
      linkAccess
    );
    if (linkAccess === "invited" && receipt.linkAccess !== "invited") {
      await this.delete(receipt.docId, licenseKey);
      throw new OpenArtifactsClientError(
        PRIVATE_UNSUPPORTED_MESSAGE,
        "private_unsupported",
        null,
        false
      );
    }
    return receipt;
  }

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

  getAccess(docId: string, licenseKey: string): Promise<OpenArtifactsAccess> {
    return this.access("GET", docId, "", licenseKey);
  }

  setLinkAccess(
    docId: string,
    linkAccess: OpenArtifactsLinkAccess,
    licenseKey: string
  ): Promise<OpenArtifactsAccess> {
    return this.access("PUT", docId, "", licenseKey, { linkAccess });
  }

  addPerson(docId: string, email: string, licenseKey: string): Promise<OpenArtifactsAccess> {
    return this.access("PUT", docId, `/people/${encodeURIComponent(email)}`, licenseKey);
  }

  removePerson(docId: string, email: string, licenseKey: string): Promise<OpenArtifactsAccess> {
    return this.access("DELETE", docId, `/people/${encodeURIComponent(email)}`, licenseKey);
  }

  async openAsOwner(docId: string, licenseKey: string): Promise<string> {
    const response = await this.request({
      url: `${DOCS_ENDPOINT}/${encodeURIComponent(docId)}/open`,
      method: "POST",
      headers: authorizationHeaders(licenseKey),
      throw: false,
    });
    if (response.status !== 200) {
      throw errorFromResponse(response);
    }
    const value = responseJson(response);
    if (!isRecord(value) || typeof value.url !== "string" || !isHttpsUrl(value.url)) {
      throw malformedResponse(response.status);
    }
    return value.url;
  }

  private async access(
    method: "GET" | "PUT" | "DELETE",
    docId: string,
    suffix: string,
    licenseKey: string,
    body?: { linkAccess: OpenArtifactsLinkAccess }
  ): Promise<OpenArtifactsAccess> {
    const response = await this.request({
      url: `${DOCS_ENDPOINT}/${encodeURIComponent(docId)}/access${suffix}`,
      method,
      headers: authorizationHeaders(licenseKey),
      ...(body && { contentType: "application/json", body: JSON.stringify(body) }),
      throw: false,
    });
    if (response.status !== 200) {
      throw errorFromResponse(response);
    }
    const value = responseJson(response);
    if (
      !isRecord(value) ||
      value.docId !== docId ||
      (value.linkAccess !== "anyone" && value.linkAccess !== "invited") ||
      typeof value.url !== "string" ||
      !Array.isArray(value.people)
    ) {
      throw malformedResponse(response.status);
    }
    return value as unknown as OpenArtifactsAccess;
  }

  private async push(
    method: "POST" | "PUT",
    url: string,
    document: OpenArtifactsDocument,
    licenseKey: string,
    expectedDocId?: string,
    linkAccess?: OpenArtifactsLinkAccess
  ): Promise<OpenArtifactsReceipt> {
    let response: RequestUrlResponse;
    try {
      response = await this.request({
        url,
        method,
        headers: authorizationHeaders(licenseKey),
        contentType: "application/json",
        body: JSON.stringify({
          title: document.title,
          html: document.html,
          ...(linkAccess === "invited" && { linkAccess }),
        }),
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

  const { docId, url, version, linkAccess } = value;
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

  return {
    docId,
    url,
    version,
    ...((linkAccess === "anyone" || linkAccess === "invited") && { linkAccess }),
  };
}

function errorFromResponse(response: RequestUrlResponse): OpenArtifactsClientError {
  const value = responseJson(response);
  if (!isErrorResponse(value)) {
    return malformedResponse(response.status);
  }

  const { code, message, limit, upgrade_url: upgradeUrl } = value.error;
  return new OpenArtifactsClientError(
    message,
    code,
    response.status,
    code === "internal" || response.status >= 500,
    response.status === 402 && limit === "privateSharing" && upgradeUrl && isHttpsUrl(upgradeUrl)
      ? upgradeUrl
      : undefined
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
    // Only the canonical document host is accepted for new server receipts.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/337
    return (
      url.origin === OPENARTIFACTS_DOCUMENT_ORIGIN &&
      url.pathname.replace(/\/$/, "") === `/d/${docId}`
    );
  } catch {
    return false;
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
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

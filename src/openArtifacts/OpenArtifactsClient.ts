import {
  OPENARTIFACTS_API_ORIGIN,
  OPENARTIFACTS_DOCUMENT_ORIGIN,
  OPENARTIFACTS_CLIENT_HEADER,
  OPENARTIFACTS_CLIENT_ID,
  OPENARTIFACTS_DOC_ID_PATTERN,
} from "@/openArtifacts/constants";
import { createProductUrl, PRODUCT_URLS } from "@/lib/productLinks";
import type {
  OpenArtifactsAccess,
  OpenArtifactsDocument,
  OpenArtifactsErrorResponse,
  OpenArtifactsGuidance,
  OpenArtifactsLinkAccess,
  OpenArtifactsReceipt,
} from "@/openArtifacts/types";
import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";

const DOCS_ENDPOINT = `${OPENARTIFACTS_API_ORIGIN}/api/v1/docs`;
const NETWORK_ERROR_MESSAGE = "Could not reach OpenArtifacts. Please try again.";
const PRIVATE_DOCS_ENDPOINT = `${OPENARTIFACTS_API_ORIGIN}/api/v1/private-docs`;
// A private create is its own route, so a server without private sharing answers 404 and creates nothing.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/707
const PRIVATE_UNSUPPORTED_MESSAGE =
  "This OpenArtifacts server does not support private documents. Nothing was published.";
// The reference CLI's wording: an unconfigured server answers the whole access family with the same 404 as an old one.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/707
const PRIVATE_UNAVAILABLE_MESSAGE = "Not found, or this server does not support private documents.";
const AMBIGUOUS_PUBLISH_MESSAGE =
  "OpenArtifacts may have published this note, but Copilot did not receive a valid receipt. To avoid creating a duplicate page, this publish cannot be retried until the plugin reloads.";

// The code of an access-family 404; the modal keys its unsupported-server view on it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/707
export const PRIVATE_UNAVAILABLE_CODE = "private_unavailable";

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
    linkAccess?: OpenArtifactsLinkAccess,
    requestLinkOffer = false
  ): Promise<OpenArtifactsReceipt> {
    // Never falls back to POST /api/v1/docs, which would publish the page to anyone.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/707
    return linkAccess === "invited"
      ? this.push(
          "POST",
          PRIVATE_DOCS_ENDPOINT,
          document,
          licenseKey,
          undefined,
          true,
          requestLinkOffer
        )
      : this.push("POST", DOCS_ENDPOINT, document, licenseKey, undefined, false, requestLinkOffer);
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

  async openAsOwner(docId: string, licenseKey: string): Promise<string> {
    const response = await this.request({
      url: `${DOCS_ENDPOINT}/${encodeURIComponent(docId)}/open`,
      method: "POST",
      headers: authorizationHeaders(licenseKey),
      throw: false,
    });
    if (response.status === 404) {
      // An old or unconfigured server has no /open, and the owner route answers the canonical url for a
      // public doc, so opening the canonical url is equivalent. The returned url is opened and discarded.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/707
      return `${OPENARTIFACTS_DOCUMENT_ORIGIN}/d/${docId}`;
    }
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
    if (response.status === 404) {
      // Not yours, deleted, an old Worker and a server without reader sign-in all answer 404.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/707
      throw new OpenArtifactsClientError(
        PRIVATE_UNAVAILABLE_MESSAGE,
        PRIVATE_UNAVAILABLE_CODE,
        404,
        false
      );
    }
    if (response.status !== 200) {
      throw errorFromResponse(response);
    }
    const value = responseJson(response);
    if (
      !isRecord(value) ||
      value.docId !== docId ||
      (value.linkAccess !== "anyone" && value.linkAccess !== "invited") ||
      typeof value.email !== "boolean" ||
      typeof value.url !== "string" ||
      !isOpenArtifactsDocumentUrl(value.url, docId) ||
      !Array.isArray(value.people) ||
      !Array.isArray(value.requests) ||
      // A malformed server response must not crash the access panel.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/707
      !value.people.every(
        (person) =>
          isRecord(person) &&
          typeof person.email === "string" &&
          (person.role === "view" || person.role === "comment") &&
          typeof person.addedAt === "number" &&
          Number.isFinite(person.addedAt)
      ) ||
      !value.requests.every(
        (request) =>
          isRecord(request) &&
          typeof request.email === "string" &&
          typeof request.requestedAt === "number" &&
          Number.isFinite(request.requestedAt)
      )
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
    privateCreate = false,
    requestLinkOffer = false
  ): Promise<OpenArtifactsReceipt> {
    let response: RequestUrlResponse;
    try {
      response = await this.request({
        url,
        method,
        headers: {
          ...authorizationHeaders(licenseKey),
          // Only a create asks for the account-link offer, and only until the vault has received it.
          // https://github.com/Brevilabs/OpenArtifacts/issues/94
          ...(requestLinkOffer && { [OPENARTIFACTS_CLIENT_HEADER]: OPENARTIFACTS_CLIENT_ID }),
        },
        contentType: "application/json",
        body: JSON.stringify({
          title: document.title,
          html: document.html,
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
    if (privateCreate && response.status === 404) {
      // Mapped from the status alone, before the body is parsed, so a non-JSON 404 maps the same way.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/707
      throw new OpenArtifactsClientError(
        PRIVATE_UNSUPPORTED_MESSAGE,
        "private_unsupported",
        404,
        false
      );
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

  const { docId, url, version, linkAccess, guidance } = value;
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
    ...(isGuidance(guidance) && { guidance: { message: guidance.message, url: guidance.url } }),
  };
}

function isGuidance(value: unknown): value is OpenArtifactsGuidance {
  return (
    isRecord(value) &&
    typeof value.message === "string" &&
    value.message.length > 0 &&
    typeof value.url === "string" &&
    isHttpsUrl(value.url)
  );
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
    response.status === 402 && limit === "privateSharing"
      ? privateSharingUpgradeUrl(upgradeUrl)
      : undefined
  );
}

/**
 * The server's https upgrade link when it sends one. A license-key 402 carries none, and Copilot always
 * authenticates with a license key, so it falls back to the Copilot pricing page.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/707
 */
function privateSharingUpgradeUrl(serverUrl: string | undefined): string {
  return serverUrl && isHttpsUrl(serverUrl)
    ? serverUrl
    : createProductUrl(PRODUCT_URLS.COPILOT_PRICING, "openartifacts_private_sharing");
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

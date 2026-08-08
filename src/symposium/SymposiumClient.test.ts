import { SymposiumClient, SymposiumClientError } from "@/symposium/SymposiumClient";
import { SYMPOSIUM_API_ORIGIN } from "@/symposium/constants";
import type { SymposiumDocument } from "@/symposium/types";
import { requestUrl, type RequestUrlResponse } from "obsidian";

jest.mock("obsidian", () => ({
  requestUrl: jest.fn(),
}));

const DOC_ID = "9f2k4mvq7t0xbz3n";
const DOCUMENT: SymposiumDocument = {
  title: "Architecture",
  html: "<!doctype html><html><body>Review</body></html>",
  byteLength: 52,
};

function response(status: number, json?: unknown): RequestUrlResponse {
  return {
    status,
    headers: {},
    arrayBuffer: new ArrayBuffer(0),
    json,
    text: json === undefined ? "" : JSON.stringify(json),
  };
}

async function expectClientError(
  promise: Promise<unknown>,
  expected: {
    message: string;
    code: string;
    status: number | null;
    retryable: boolean;
  }
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected SymposiumClientError");
  } catch (error) {
    expect(error).toBeInstanceOf(SymposiumClientError);
    expect(error).toMatchObject(expected);
  }
}

describe("SymposiumClient", () => {
  const mockedRequestUrl = requestUrl as jest.MockedFunction<typeof requestUrl>;

  beforeEach(() => {
    mockedRequestUrl.mockReset();
  });

  describe("SymposiumClientError", () => {
    describe("constructor()", () => {
      it("retains the server-facing fields needed by the UI", () => {
        const error = new SymposiumClientError("Try again.", "internal", 500, true);

        expect(error).toBeInstanceOf(Error);
        expect(error).toMatchObject({
          name: "SymposiumClientError",
          message: "Try again.",
          code: "internal",
          status: 500,
          retryable: true,
        });
      });
    });
  });

  describe("SymposiumClient", () => {
    describe("publish()", () => {
      it("posts only title and HTML to the fixed endpoint and returns the server URL verbatim", async () => {
        const returnedUrl = `https://symposium.site/d/${DOC_ID}?from=server#exact`;
        mockedRequestUrl.mockResolvedValue(
          response(201, { docId: DOC_ID, url: returnedUrl, version: 1 })
        );

        const receipt = await new SymposiumClient().publish(DOCUMENT, "decrypted-license");

        expect(receipt).toEqual({ docId: DOC_ID, url: returnedUrl, version: 1 });
        expect(mockedRequestUrl).toHaveBeenCalledWith({
          url: `${SYMPOSIUM_API_ORIGIN}/api/v1/docs`,
          method: "POST",
          headers: { Authorization: "Bearer decrypted-license" },
          contentType: "application/json",
          body: JSON.stringify({ title: DOCUMENT.title, html: DOCUMENT.html }),
          throw: false,
        });
      });

      it.each([
        [
          "an invalid license",
          401,
          "unauthorized",
          "That license key is not valid for publishing.",
          false,
        ],
        [
          "an ineligible plan",
          401,
          "unauthorized",
          "Publishing is currently limited to lifetime license holders.",
          false,
        ],
        ["an oversized document", 413, "too_large", "That push is too large to accept.", false],
        ["a quota limit", 429, "quota_exceeded", "You have used all of today's pushes.", false],
        [
          "a license validation outage",
          500,
          "internal",
          "License validation is temporarily unavailable.",
          true,
        ],
      ])(
        "preserves the structured error for %s",
        async (_case, status, code, message, retryable) => {
          mockedRequestUrl.mockResolvedValue(response(status, { error: { code, message } }));

          await expectClientError(new SymposiumClient().publish(DOCUMENT, "decrypted-license"), {
            message,
            code,
            status,
            retryable,
          });
        }
      );

      it("rejects malformed error envelopes without exposing their raw body", async () => {
        mockedRequestUrl.mockResolvedValue(response(401, { message: "no envelope" }));

        await expectClientError(new SymposiumClient().publish(DOCUMENT, "decrypted-license"), {
          message: "Symposium returned an invalid response (HTTP 401).",
          code: "malformed_response",
          status: 401,
          retryable: false,
        });
      });

      it.each([
        ["invalid doc id", { docId: "UPPERCASE", url: "https://symposium.site/d/x", version: 1 }],
        ["non-HTTPS URL", { docId: DOC_ID, url: "http://symposium.site/d/x", version: 1 }],
        [
          "mismatched document URL",
          { docId: DOC_ID, url: "https://symposium.site/d/0123456789abcdef", version: 1 },
        ],
        ["non-integer version", { docId: DOC_ID, url: "https://symposium.site/d/x", version: 1.5 }],
      ])("treats a successful POST with %s as ambiguous", async (_case, receipt) => {
        mockedRequestUrl.mockResolvedValue(response(201, receipt));

        await expectClientError(new SymposiumClient().publish(DOCUMENT, "decrypted-license"), {
          message:
            "Symposium may have published this note, but Copilot did not receive a valid receipt. To avoid creating a duplicate page, this publish cannot be retried until the plugin reloads.",
          code: "ambiguous_publish",
          status: 201,
          retryable: false,
        });
      });

      it("treats an unexpected successful POST status as ambiguous", async () => {
        mockedRequestUrl.mockResolvedValue(response(200));

        await expectClientError(new SymposiumClient().publish(DOCUMENT, "decrypted-license"), {
          message:
            "Symposium may have published this note, but Copilot did not receive a valid receipt. To avoid creating a duplicate page, this publish cannot be retried until the plugin reloads.",
          code: "ambiguous_publish",
          status: 200,
          retryable: false,
        });
      });

      it("marks a request failure as ambiguous and non-retryable", async () => {
        mockedRequestUrl.mockRejectedValue(new Error("socket failed"));

        await expectClientError(new SymposiumClient().publish(DOCUMENT, "decrypted-license"), {
          message:
            "Symposium may have published this note, but Copilot did not receive a valid receipt. To avoid creating a duplicate page, this publish cannot be retried until the plugin reloads.",
          code: "ambiguous_publish",
          status: null,
          retryable: false,
        });
      });
    });

    describe("update()", () => {
      it("puts the next version at the existing document route", async () => {
        const receipt = {
          docId: DOC_ID,
          url: `https://symposium.site/d/${DOC_ID}`,
          version: 2,
        };
        mockedRequestUrl.mockResolvedValue(response(200, receipt));

        await expect(
          new SymposiumClient().update(DOC_ID, DOCUMENT, "decrypted-license")
        ).resolves.toEqual(receipt);
        expect(mockedRequestUrl).toHaveBeenCalledWith({
          url: `${SYMPOSIUM_API_ORIGIN}/api/v1/docs/${DOC_ID}`,
          method: "PUT",
          headers: { Authorization: "Bearer decrypted-license" },
          contentType: "application/json",
          body: JSON.stringify({ title: DOCUMENT.title, html: DOCUMENT.html }),
          throw: false,
        });
      });

      it("returns not_found without an implicit POST fallback", async () => {
        mockedRequestUrl.mockResolvedValue(
          response(404, {
            error: { code: "not_found", message: `No doc with id ${DOC_ID}.` },
          })
        );

        await expectClientError(
          new SymposiumClient().update(DOC_ID, DOCUMENT, "decrypted-license"),
          {
            message: `No doc with id ${DOC_ID}.`,
            code: "not_found",
            status: 404,
            retryable: false,
          }
        );
        expect(mockedRequestUrl).toHaveBeenCalledTimes(1);
        expect(mockedRequestUrl).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT" }));
      });

      it("rejects a receipt for a different document identity", async () => {
        mockedRequestUrl.mockResolvedValue(
          response(200, {
            docId: "0123456789abcdef",
            url: "https://symposium.site/d/0123456789abcdef",
            version: 2,
          })
        );

        await expectClientError(
          new SymposiumClient().update(DOC_ID, DOCUMENT, "decrypted-license"),
          {
            message: "Symposium returned an invalid response (HTTP 200).",
            code: "malformed_response",
            status: 200,
            retryable: false,
          }
        );
      });

      it("keeps a malformed PUT receipt distinct from ambiguous creation", async () => {
        mockedRequestUrl.mockResolvedValue(
          response(200, {
            docId: DOC_ID,
            url: "http://symposium.site/d/x",
            version: 2,
          })
        );

        await expectClientError(
          new SymposiumClient().update(DOC_ID, DOCUMENT, "decrypted-license"),
          {
            message: "Symposium returned an invalid response (HTTP 200).",
            code: "malformed_response",
            status: 200,
            retryable: false,
          }
        );
      });

      it("keeps a PUT transport failure retryable because the document id is stable", async () => {
        mockedRequestUrl.mockRejectedValue(new Error("socket failed"));

        await expectClientError(
          new SymposiumClient().update(DOC_ID, DOCUMENT, "decrypted-license"),
          {
            message: "Could not reach Symposium. Please try again.",
            code: "network",
            status: null,
            retryable: true,
          }
        );
      });
    });

    describe("delete()", () => {
      it("deletes the existing document without sending a body", async () => {
        mockedRequestUrl.mockResolvedValue(response(204));

        await expect(
          new SymposiumClient().delete(DOC_ID, "decrypted-license")
        ).resolves.toBeUndefined();
        expect(mockedRequestUrl).toHaveBeenCalledWith({
          url: `${SYMPOSIUM_API_ORIGIN}/api/v1/docs/${DOC_ID}`,
          method: "DELETE",
          headers: { Authorization: "Bearer decrypted-license" },
          throw: false,
        });
      });

      it("treats structured 404 not_found as an idempotent success", async () => {
        mockedRequestUrl.mockResolvedValue(
          response(404, {
            error: { code: "not_found", message: `No doc with id ${DOC_ID}.` },
          })
        );

        await expect(
          new SymposiumClient().delete(DOC_ID, "decrypted-license")
        ).resolves.toBeUndefined();
      });

      it.each([
        [
          "a different 404 code",
          response(404, { error: { code: "unauthorized", message: "Invalid key." } }),
          {
            message: "Invalid key.",
            code: "unauthorized",
            status: 404,
            retryable: false,
          },
        ],
        [
          "an unstructured 404",
          response(404, { message: "missing" }),
          {
            message: "Symposium returned an invalid response (HTTP 404).",
            code: "malformed_response",
            status: 404,
            retryable: false,
          },
        ],
        [
          "an unexpected 200",
          response(200),
          {
            message: "Symposium returned an invalid response (HTTP 200).",
            code: "malformed_response",
            status: 200,
            retryable: false,
          },
        ],
      ])(
        "rejects %s instead of treating it as deleted",
        async (_case, serverResponse, expected) => {
          mockedRequestUrl.mockResolvedValue(serverResponse);

          await expectClientError(
            new SymposiumClient().delete(DOC_ID, "decrypted-license"),
            expected
          );
        }
      );
    });
  });
});
